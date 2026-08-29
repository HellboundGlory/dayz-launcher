use std::net::Ipv4Addr;
use tauri::{AppHandle, Emitter};

/// The scheme `register_dzsa_protocol` claims in the OS.
const SCHEME: &str = "dzsa://";

/// The one path this scheme carries: `dzsa://connect/IP:PORT[?fav=1]`.
const CONNECT_SEGMENT: &str = "connect/";

/// What a `dzsa://connect/...` link asks the launcher to do, parsed out of
/// the raw string. Emitted to the frontend as the `dzsa-connect` event.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub ip: String,
    pub query_port: u16,
    /// Whether the link asked to favourite the server too, not just select
    /// it — the landing page's "Join & Favourite" option.
    pub favourite: bool,
}

/// Parse a `dzsa://connect/IP:PORT[?fav=1]` link.
///
/// `None` for anything that doesn't match — a malformed or foreign link is
/// silently ignored rather than guessed at, the same way a malformed server
/// address is elsewhere in this codebase.
///
/// The IP is parsed as an `Ipv4Addr`, not merely checked for non-emptiness.
/// This is the widest untrusted-input surface in the app — the scheme is
/// registered OS-wide and reachable from any web page — and the emitted
/// `ConnectRequest` used to carry whatever string sat before the first `:`
/// unexamined. `Ipv4Addr::from_str` also rejects octal-looking octets
/// (leading zeros), which is a deliberate hardening in std against exactly
/// the ambiguous-parse class of bug this validation exists to close off.
pub fn parse_connect_link(link: &str) -> Option<ConnectRequest> {
    let lower = link.to_ascii_lowercase();
    if !lower.starts_with(SCHEME) {
        return None;
    }
    if !lower[SCHEME.len()..].starts_with(CONNECT_SEGMENT) {
        return None;
    }
    let after_connect = &link[SCHEME.len() + CONNECT_SEGMENT.len()..];
    let (addr, query) = after_connect.split_once('?').unwrap_or((after_connect, ""));
    let (ip, port) = addr.split_once(':')?;
    let ip: Ipv4Addr = ip.parse().ok()?;
    let query_port: u16 = port.parse().ok()?;
    let favourite = query
        .split('&')
        .any(|kv| matches!(kv, "fav=1" | "fav=true"));
    Some(ConnectRequest {
        ip: ip.to_string(),
        query_port,
        favourite,
    })
}

/// Pull a `dzsa://` link out of a process's command line, if it carries one.
///
/// Windows hands a registered protocol handler its URL as a plain argument, so
/// this is the only place a deep link appears. Everything else on the line —
/// the executable path, `--autostart` — is ignored.
pub fn link_in_argv(argv: &[String]) -> Option<&str> {
    argv.iter()
        .map(String::as_str)
        .find(|arg| arg.to_ascii_lowercase().starts_with(SCHEME))
}

/// Handle a `dzsa://` link on this process's command line, however it got
/// there: the launcher's own cold-start argv, or a second launch's argv
/// forwarded here by the single-instance plugin (without this the link would
/// otherwise be lost outright — the OS starts a second process to carry it,
/// single-instance kills that process, and nothing in the surviving one ever
/// sees the argument).
///
/// Parses the link and hands it to the frontend as a `dzsa-connect` event —
/// see `App.tsx`'s listener. Never launches DayZ itself: a deep link selects
/// (and optionally favourites) a server, but joining still needs the user to
/// press the button themselves, deliberately. A webpage should not have the
/// power to spawn the game unattended.
pub fn handle_argv(app: &AppHandle, argv: &[String]) {
    let Some(link) = link_in_argv(argv) else {
        return;
    };
    let Some(request) = parse_connect_link(link) else {
        eprintln!("[protocol] Could not parse dzsa:// link: {link}");
        return;
    };
    let _ = app.emit("dzsa-connect", request);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_link_is_found_past_the_executable_path() {
        let args = argv(&[
            r"C:\Program Files\Tetra Launcher\tetra-launcher.exe",
            "dzsa://connect/1.2.3.4:2302",
        ]);
        assert_eq!(link_in_argv(&args), Some("dzsa://connect/1.2.3.4:2302"));
    }

    /// Windows does not promise a case for the scheme it hands back, and the
    /// registry key it comes from is case-insensitive.
    #[test]
    fn the_scheme_is_matched_case_insensitively() {
        let args = argv(&["tetra-launcher.exe", "DZSA://connect/1.2.3.4:2302"]);
        assert!(link_in_argv(&args).is_some());
    }

    /// The ordinary autostart launch. Treating `--autostart` as a link would
    /// mean every boot looked like a join request.
    #[test]
    fn an_ordinary_launch_carries_no_link() {
        assert_eq!(link_in_argv(&argv(&["tetra-launcher.exe"])), None);
        assert_eq!(
            link_in_argv(&argv(&["tetra-launcher.exe", "--autostart"])),
            None
        );
    }

    #[test]
    fn a_plain_connect_link_parses() {
        assert_eq!(
            parse_connect_link("dzsa://connect/51.254.46.15:2303"),
            Some(ConnectRequest {
                ip: "51.254.46.15".into(),
                query_port: 2303,
                favourite: false,
            })
        );
    }

    #[test]
    fn a_favourite_query_param_is_read() {
        let parsed = parse_connect_link("dzsa://connect/51.254.46.15:2303?fav=1").unwrap();
        assert!(parsed.favourite);
    }

    #[test]
    fn the_scheme_and_segment_are_matched_case_insensitively() {
        assert!(parse_connect_link("DZSA://CONNECT/1.2.3.4:2302").is_some());
    }

    #[test]
    fn a_missing_port_does_not_parse() {
        assert_eq!(parse_connect_link("dzsa://connect/1.2.3.4"), None);
    }

    #[test]
    fn a_non_numeric_port_does_not_parse() {
        assert_eq!(parse_connect_link("dzsa://connect/1.2.3.4:notaport"), None);
    }

    #[test]
    fn a_missing_ip_does_not_parse() {
        assert_eq!(parse_connect_link("dzsa://connect/:2302"), None);
    }

    /// The regression this validation exists to close: before the IP was
    /// parsed as an `Ipv4Addr`, anything non-empty before the first `:`
    /// passed — a link crafted by a hostile web page could carry an
    /// arbitrary string all the way to the `dzsa-connect` event the frontend
    /// trusts.
    #[test]
    fn a_non_ipv4_host_does_not_parse() {
        assert_eq!(parse_connect_link("dzsa://connect/example.com:2302"), None);
        assert_eq!(
            parse_connect_link("dzsa://connect/not-an-ip-at-all:2302"),
            None
        );
    }

    /// Leading zeros are ambiguous between decimal and octal in some parsers
    /// (`010` meaning 8, not 10). Rust's `Ipv4Addr::from_str` rejects them
    /// outright rather than guessing, and this pins that we rely on it.
    #[test]
    fn an_octet_with_a_leading_zero_does_not_parse() {
        assert_eq!(
            parse_connect_link("dzsa://connect/192.168.001.001:2302"),
            None
        );
    }

    #[test]
    fn a_foreign_scheme_does_not_parse() {
        assert_eq!(parse_connect_link("https://connect/1.2.3.4:2302"), None);
    }

    #[test]
    fn a_missing_connect_segment_does_not_parse() {
        assert_eq!(parse_connect_link("dzsa://1.2.3.4:2302"), None);
    }
}
