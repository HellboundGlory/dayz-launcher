use super::probe::info_row;
use super::{blocking_read, prober, to_server32, Server32};
use crate::state::AppState;
use std::net::{Ipv4Addr, SocketAddr};
use tauri::State;
use tetra_registry::filter::address_search;
use tetra_registry::rows::ServerKey;

/// Longest address the lookup accepts; anything longer cannot be `ip:port`.
const MAX_ADDR_LEN: usize = 64;

/// The `ip:port` that `addr` names, `None` for a bare IP, or why it is refused.
fn parse_address(addr: &str) -> Result<Option<(Ipv4Addr, u16)>, String> {
    if addr.len() > MAX_ADDR_LEN {
        return Err("Address is too long".into());
    }
    match address_search(addr) {
        None => Err(format!("Not an ip:port address: {addr}")),
        Some((_, None)) => Ok(None),
        Some((ip, Some(_))) if ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast() => {
            Err(format!("Not a server address: {addr}"))
        }
        Some((ip, Some(port))) => Ok(Some((ip, port))),
    }
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
    let writer = super::registry_writer(&state).await?;
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
            let found = (outcome.addr.port(), info, outcome.rtt);
            if found.0 == port {
                typed = Some(found);
                break;
            }
            next = Some(found);
        }
    }
    let Some((query_port, mut info, rtt)) = typed.or(next) else {
        return Ok(None);
    };
    if query_port != port && info.game_port.is_none() {
        info.game_port = Some(port);
    }

    let key = ServerKey { ip, query_port };
    writer
        .upsert_servers(vec![info_row(key, info, rtt)])
        .await
        .map_err(|e| e.to_string())?;
    writer
        .set_online(vec![key], true)
        .await
        .map_err(|e| e.to_string())?;
    blocking_read(&state, move |reader| {
        Ok(reader
            .get(key)
            .map_err(|e| e.to_string())?
            .map(|row| to_server32(&row)))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::parse_address;

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
}
