use super::probe::info_row;
use super::{blocking_read, prober, registry_writer, to_server32, Server32};
use crate::state::AppState;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::time::Duration;
use tauri::State;
use tetra_net::find::find_server_at;
use tetra_registry::filter::address_search;
use tetra_registry::rows::ServerKey;

/// Longest address the lookup accepts; anything longer cannot be `ip:port`.
const MAX_ADDR_LEN: usize = 64;

/// Longest text `find_server` takes, and the longest host name inside it.
const MAX_TARGET_LEN: usize = 255;
const MAX_HOST_LEN: usize = 253;

/// Longest label of a host name.
const MAX_LABEL_LEN: usize = 63;

/// How long a host name may take to resolve.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

/// Most addresses one host name is probed on, and the most resolver entries
/// read looking for them. A name with more is a CDN, not one server.
const MAX_RESOLVED: usize = 4;
const MAX_RESOLVED_SCAN: usize = 32;

/// The `ip:port` that `addr` names, `None` for a bare IP, or why it is refused.
fn parse_address(addr: &str) -> Result<Option<(Ipv4Addr, u16)>, String> {
    if addr.len() > MAX_ADDR_LEN {
        return Err("Address is too long".into());
    }
    match address_search(addr) {
        None => Err(format!("Not an ip:port address: {addr}")),
        Some((_, None)) => Ok(None),
        Some((ip, Some(port))) => check_ip(ip)
            .map(|()| Some((ip, port)))
            .map_err(|_| format!("Not a server address: {addr}")),
    }
}

/// What a typed address names: an IPv4 address, or a name to resolve.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Host {
    Ip(Ipv4Addr),
    Name(String),
}

/// A typed address and the port it mentioned, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Target {
    host: Host,
    port: Option<u16>,
}

/// Read what a player typed in the Add server field: a host name or an IPv4
/// address, with an optional port.
fn parse_target(text: &str) -> Result<Target, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Type an address".into());
    }
    if text.chars().count() > MAX_TARGET_LEN
        || text
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || !c.is_ascii())
    {
        return Err("That is not an address".into());
    }
    if text.contains('/') || text.contains('@') || text.contains("://") {
        return Err("Type just the address, like play.example.com:2302".into());
    }

    let (host, port) = match text.split_once(':') {
        None => (text, None),
        Some((host, port)) => {
            if port.contains(':') {
                return Err("IPv6 addresses are not supported".into());
            }
            let all_digits = port.bytes().all(|b| b.is_ascii_digit());
            match port.parse::<u16>() {
                Ok(port) if all_digits && port != 0 => (host, Some(port)),
                _ => return Err("The port must be 1 to 65535".into()),
            }
        }
    };

    let host = match Ipv4Addr::from_str(host) {
        Ok(ip) => Host::Ip(ip),
        Err(_) if is_host_name(host) => Host::Name(host.to_string()),
        Err(_) => return Err("That is not an IP address or host name".into()),
    };
    Ok(Target { host, port })
}

/// Whether `text` is a host name a resolver may be asked about. The last label
/// must start with a letter, so a half-typed number cannot reach it as one.
fn is_host_name(text: &str) -> bool {
    if text.len() > MAX_HOST_LEN {
        return false;
    }
    let labels: Vec<&str> = text.split('.').collect();
    let named = labels
        .last()
        .and_then(|last| last.chars().next())
        .is_some_and(|first| first.is_ascii_alphabetic());
    named
        && labels.iter().all(|label| {
            (1..=MAX_LABEL_LEN).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

/// Refuse an address no server can listen on, with the message the lookup
/// command reports for it.
fn check_ip(ip: Ipv4Addr) -> Result<(), String> {
    if crate::protocol::is_server_address(ip) {
        Ok(())
    } else {
        Err(format!("Not a server address: {ip}"))
    }
}

/// Store one answered server and read its row back for the frontend.
async fn store_answer(
    state: &AppState,
    writer: &tetra_registry::Writer,
    key: ServerKey,
    info: tetra_core::a2s::info::ServerInfo,
    ping: Option<tetra_net::PingReading>,
) -> Result<Option<Server32>, String> {
    writer
        .upsert_servers(vec![info_row(key, info, ping)])
        .await
        .map_err(|e| e.to_string())?;
    writer
        .record_online(vec![key], true)
        .await
        .map_err(|e| e.to_string())?;
    blocking_read(state, move |reader| {
        Ok(reader
            .get(key)
            .map_err(|e| e.to_string())?
            .map(|row| to_server32(&row)))
    })
    .await
}

/// The server at `addr` (`ip:port`). The registry is checked first; otherwise the
/// address and the port after it are probed, and the first answer is stored.
#[tauri::command]
pub async fn lookup_server(
    state: State<'_, AppState>,
    addr: String,
) -> Result<Option<Server32>, String> {
    let Some((ip, port)) = parse_address(&addr)? else {
        return Ok(None);
    };
    let writer = registry_writer(&state).await?;
    let known = blocking_read(&state, move |reader| {
        reader.find_by_address(ip, port).map_err(|e| e.to_string())
    })
    .await?;
    if let Some(row) = known {
        return Ok(Some(to_server32(&row)));
    }

    let mut targets = vec![SocketAddr::from((ip, port))];
    if let Some(next) = port.checked_add(1) {
        targets.push(SocketAddr::from((ip, next)));
    }
    // The typed port wins; the next port only counts when the typed one is silent,
    // since a host often runs another server there.
    let mut answers = prober(&state)?.refresh(targets);
    let (mut typed, mut next) = (None, None);
    while let Some(outcome) = answers.recv().await {
        if let Ok(info) = outcome.result {
            let found = (outcome.addr.port(), info, outcome.ping);
            if found.0 == port {
                typed = Some(found);
                break;
            }
            next = Some(found);
        }
    }
    let Some((query_port, mut info, ping)) = typed.or(next) else {
        return Ok(None);
    };
    if query_port != port && info.game_port.is_none() {
        info.game_port = Some(port);
    }

    store_answer(&state, &writer, ServerKey { ip, query_port }, info, ping).await
}

/// The IPv4 addresses a typed host resolves to, in the order a probe should
/// try them.
async fn resolve_host(host: &Host) -> Result<Vec<Ipv4Addr>, String> {
    let name = match host {
        Host::Ip(ip) => {
            check_ip(*ip)?;
            return Ok(vec![*ip]);
        }
        Host::Name(name) => name,
    };

    let resolved =
        tokio::time::timeout(RESOLVE_TIMEOUT, tokio::net::lookup_host((name.as_str(), 0)))
            .await
            .map_err(|_| "Could not find that host name".to_string())?
            .map_err(|_| "Could not find that host name".to_string())?;

    let mut ips = Vec::new();
    for addr in resolved.take(MAX_RESOLVED_SCAN) {
        let IpAddr::V4(ip) = addr.ip() else {
            continue;
        };
        if !ips.contains(&ip) {
            ips.push(ip);
        }
        if ips.len() == MAX_RESOLVED {
            break;
        }
    }
    ips.retain(|ip| check_ip(*ip).is_ok());
    if ips.is_empty() {
        return Err("That host name has no usable IPv4 address".into());
    }
    Ok(ips)
}

/// Whether a stored row can answer a lookup without a probe. One marked offline
/// failed its last probe, and a nameless one was only ever listed, never
/// answered; both are probed again.
fn stored_row_is_current(row: &tetra_registry::filter::ServerListRow) -> bool {
    row.online && !row.name.trim().is_empty()
}

/// Find the server a player typed an address for: a host name or an IPv4
/// address, with or without a port.
#[tauri::command]
pub async fn find_server(
    state: State<'_, AppState>,
    input: String,
) -> Result<Option<Server32>, String> {
    let target = parse_target(&input)?;
    let ips = resolve_host(&target.host).await?;
    let writer = registry_writer(&state).await?;

    // A server already on the list and online answers from here without a
    // probe. The writer wait above also means the registry is open for this read.
    if let Some(port) = target.port {
        let wanted = ips.clone();
        let known = blocking_read(&state, move |reader| {
            for ip in wanted {
                if let Some(row) = reader
                    .find_by_address(ip, port)
                    .map_err(|e| e.to_string())?
                    .filter(stored_row_is_current)
                {
                    return Ok(Some(row));
                }
            }
            Ok(None)
        })
        .await?;
        if let Some(row) = known {
            return Ok(Some(to_server32(&row)));
        }
    }

    let Some(answer) = find_server_at(&prober(&state)?, &ips, target.port).await else {
        return Ok(None);
    };
    let SocketAddr::V4(addr) = answer.addr else {
        return Ok(None);
    };
    let mut info = answer.info;
    if info.game_port.is_none() {
        if let Some(port) = target.port.filter(|port| *port != addr.port()) {
            info.game_port = Some(port);
        }
    }

    store_answer(
        &state,
        &writer,
        ServerKey {
            ip: *addr.ip(),
            query_port: addr.port(),
        },
        info,
        // `Answer` carries only the query's own reply time, which is not a
        // ping the UI can label, so the row is stored without one.
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{check_ip, parse_address, parse_target, stored_row_is_current, Host, Target};
    use std::net::Ipv4Addr;

    #[test]
    fn lookup_addresses_are_checked_before_any_probe() {
        let too_long = "1".repeat(65);
        let cases = [
            ("40.160.57.146:2402", true),
            ("40.160.57.146", true),
            (too_long.as_str(), false),
            ("40.160.57.146:0", false),
            ("40.160.57.146:70000", false),
            ("0.0.0.0:2302", false),
            ("255.255.255.255:2302", false),
            ("224.0.0.1:2302", false),
            ("garbage", false),
        ];
        for (addr, valid) in cases {
            assert_eq!(parse_address(addr).is_ok(), valid, "address: {addr}");
        }
    }

    #[test]
    fn typed_addresses_are_read_as_an_ip_or_a_host_name_plus_an_optional_port() {
        let accepted: &[(&str, Host, Option<u16>)] = &[
            ("1.2.3.4", Host::Ip(Ipv4Addr::new(1, 2, 3, 4)), None),
            (
                "1.2.3.4:2302",
                Host::Ip(Ipv4Addr::new(1, 2, 3, 4)),
                Some(2302),
            ),
            (
                "play.example.com",
                Host::Name("play.example.com".into()),
                None,
            ),
            (
                "play.example.com:2302",
                Host::Name("play.example.com".into()),
                Some(2302),
            ),
            ("localhost", Host::Name("localhost".into()), None),
            (" 1.2.3.4 ", Host::Ip(Ipv4Addr::new(1, 2, 3, 4)), None),
        ];
        for (text, host, port) in accepted {
            assert_eq!(
                parse_target(text),
                Ok(Target {
                    host: (*host).clone(),
                    port: *port,
                }),
                "text: {text:?}"
            );
        }
    }

    #[test]
    fn a_typed_address_that_cannot_name_a_server_says_why() {
        let long_label = "a".repeat(64);
        let too_long = format!("{}.com", "a".repeat(253));
        let cases: &[(&str, &str)] = &[
            ("", "Type an address"),
            ("   ", "Type an address"),
            (&too_long, "That is not an address"),
            ("a b.com", "That is not an address"),
            ("ünï.com", "That is not an address"),
            (
                "http://x.com",
                "Type just the address, like play.example.com:2302",
            ),
            (
                "x.com/path",
                "Type just the address, like play.example.com:2302",
            ),
            (
                "user@x.com",
                "Type just the address, like play.example.com:2302",
            ),
            ("::1", "IPv6 addresses are not supported"),
            ("[::1]:2302", "IPv6 addresses are not supported"),
            ("1.2.3.4:0", "The port must be 1 to 65535"),
            ("1.2.3.4:70000", "The port must be 1 to 65535"),
            ("1.2.3.4:abc", "The port must be 1 to 65535"),
            ("1.2.3.4:+2302", "The port must be 1 to 65535"),
            ("127.1", "That is not an IP address or host name"),
            ("0x7f.1", "That is not an IP address or host name"),
            ("-bad.com", "That is not an IP address or host name"),
            ("bad-.com", "That is not an IP address or host name"),
            (&long_label, "That is not an IP address or host name"),
            ("a..com", "That is not an IP address or host name"),
            ("x.123", "That is not an IP address or host name"),
        ];
        for (text, message) in cases {
            assert_eq!(parse_target(text).unwrap_err(), *message, "text: {text:?}");
        }
    }

    /// A row's own answer decides whether a lookup may skip the probe: the
    /// online flag is what a failed refresh last wrote.
    #[tokio::test]
    async fn a_known_offline_server_is_probed_again() {
        let registry = tetra_registry::Registry::open_in_memory().expect("registry");
        let writer = registry.writer();
        let key = tetra_registry::ServerKey {
            ip: Ipv4Addr::new(203, 0, 113, 9),
            query_port: 2302,
        };
        writer
            .upsert_servers(vec![tetra_registry::ServerRow {
                key,
                name: "Known".into(),
                responded: true,
                ..Default::default()
            }])
            .await
            .expect("row");

        let stored = || {
            registry
                .reader()
                .expect("reader")
                .find_by_address(key.ip, key.query_port)
                .expect("find")
                .expect("a stored row")
        };
        assert!(
            stored_row_is_current(&stored()),
            "an answering row answers the lookup"
        );

        writer
            .record_online(vec![key], false)
            .await
            .expect("offline");

        assert!(
            !stored_row_is_current(&stored()),
            "an offline row must fall through to the probe"
        );

        let listed = tetra_registry::ServerKey {
            ip: Ipv4Addr::new(203, 0, 113, 10),
            query_port: 2302,
        };
        writer
            .upsert_servers(vec![tetra_registry::ServerRow {
                key: listed,
                responded: false,
                ..Default::default()
            }])
            .await
            .expect("listed row");
        let never_answered = registry
            .reader()
            .expect("reader")
            .find_by_address(listed.ip, listed.query_port)
            .expect("find")
            .expect("a stored row");
        assert!(
            !stored_row_is_current(&never_answered),
            "a row that never answered must fall through to the probe"
        );
    }

    #[test]
    fn only_an_address_no_server_can_hold_is_refused() {
        let refused = ["0.0.0.0", "255.255.255.255", "224.0.0.1"];
        for ip in refused {
            assert!(check_ip(ip.parse().expect("address")).is_err(), "{ip}");
        }
        let allowed = [
            "127.0.0.1",
            "192.168.1.2",
            "10.0.0.1",
            "169.254.1.1",
            "8.8.8.8",
        ];
        for ip in allowed {
            assert!(check_ip(ip.parse().expect("address")).is_ok(), "{ip}");
        }
    }
}
