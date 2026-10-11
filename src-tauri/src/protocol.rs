use std::net::Ipv4Addr;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

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

/// A `dzsa://` link that arrived before the frontend could listen. One slot:
/// a later link replaces an earlier one.
#[derive(Default)]
pub struct PendingConnect(Mutex<Option<ConnectRequest>>);

impl PendingConnect {
    /// Fills the slot from a process command line; a cold `dzsa://` link only
    /// ever appears there.
    pub fn from_argv(argv: &[String]) -> Self {
        let pending = Self::default();
        if let Some(request) = request_from_argv(argv) {
            pending.put(request);
        }
        pending
    }

    /// This process's own command line, read before any window exists.
    pub fn from_args() -> Self {
        Self::from_argv(&std::env::args().collect::<Vec<_>>())
    }

    pub fn put(&self, request: ConnectRequest) {
        *self.0.lock().unwrap() = Some(request);
    }

    pub fn take(&self) -> Option<ConnectRequest> {
        self.0.lock().unwrap().take()
    }
}

/// Parse a `dzsa://connect/IP:PORT[?fav=1]` link, `None` if malformed.
/// IP is parsed as `Ipv4Addr` (not just checked non-empty) since this is the
/// widest untrusted-input surface in the app — reachable from any web page.
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

/// Pull a `dzsa://` link out of a process's command line — the only place
/// Windows hands a registered protocol handler its URL.
pub fn link_in_argv(argv: &[String]) -> Option<&str> {
    argv.iter()
        .map(String::as_str)
        .find(|arg| arg.to_ascii_lowercase().starts_with(SCHEME))
}

fn request_from_argv(argv: &[String]) -> Option<ConnectRequest> {
    let link = link_in_argv(argv)?;
    let request = parse_connect_link(link);
    if request.is_none() {
        crate::log::line("protocol", &format!("Could not parse dzsa:// link: {link}"));
    }
    request
}

/// A `dzsa://` link on a command line: a cold start, or one forwarded by the
/// single-instance plugin. Stores it for the page and notifies a live one.
pub fn handle_argv(app: &AppHandle, argv: &[String]) {
    let Some(request) = request_from_argv(argv) else {
        return;
    };
    app.state::<PendingConnect>().put(request.clone());
    let _ = app.emit("dzsa-connect", request);
}

#[tauri::command]
pub fn take_pending_connect(pending: tauri::State<'_, PendingConnect>) -> Option<ConnectRequest> {
    pending.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    fn request(ip: &str, query_port: u16, favourite: bool) -> ConnectRequest {
        ConnectRequest {
            ip: ip.into(),
            query_port,
            favourite,
        }
    }

    #[test]
    fn only_a_dzsa_argument_is_taken_as_the_link() {
        let cases: &[(&[&str], Option<&str>)] = &[
            (
                &[
                    r"C:\Program Files\Tetra Launcher\tetra-launcher.exe",
                    "dzsa://connect/1.2.3.4:2302",
                ],
                Some("dzsa://connect/1.2.3.4:2302"),
            ),
            // Windows does not promise a case for the scheme it hands back, and
            // the registry key it comes from is case-insensitive.
            (
                &["tetra-launcher.exe", "DZSA://connect/1.2.3.4:2302"],
                Some("DZSA://connect/1.2.3.4:2302"),
            ),
            (&["tetra-launcher.exe"], None),
            // The ordinary autostart launch must not look like a join request.
            (&["tetra-launcher.exe", "--autostart"], None),
        ];
        for (args, expected) in cases {
            let args = argv(args);
            assert_eq!(link_in_argv(&args), *expected, "argv: {args:?}");
        }
    }

    #[test]
    fn a_connect_link_parses() {
        let cases: &[(&str, ConnectRequest)] = &[
            (
                "dzsa://connect/51.254.46.15:2303",
                request("51.254.46.15", 2303, false),
            ),
            (
                "dzsa://connect/51.254.46.15:2303?fav=1",
                request("51.254.46.15", 2303, true),
            ),
            // Scheme and segment are matched case-insensitively.
            (
                "DZSA://CONNECT/1.2.3.4:2302",
                request("1.2.3.4", 2302, false),
            ),
        ];
        for (link, expected) in cases {
            assert_eq!(
                parse_connect_link(link),
                Some(expected.clone()),
                "link: {link}"
            );
        }
    }

    /// One case per refusal rule: this is the widest untrusted-input surface in
    /// the app, so anything that is not `dzsa://connect/<ipv4>:<port>` is out.
    #[test]
    fn a_link_that_is_not_a_connect_request_does_not_parse() {
        let cases: &[(&str, &str)] = &[
            ("dzsa://connect/1.2.3.4", "no port"),
            ("dzsa://connect/1.2.3.4:notaport", "port is not a number"),
            ("dzsa://connect/:2302", "no ip"),
            (
                "dzsa://connect/example.com:2302",
                "host is not an ipv4 address",
            ),
            (
                "dzsa://connect/not-an-ip-at-all:2302",
                "host is not an ipv4 address",
            ),
            (
                "dzsa://connect/192.168.001.001:2302",
                "octet with a leading zero",
            ),
            ("https://connect/1.2.3.4:2302", "foreign scheme"),
            ("dzsa://1.2.3.4:2302", "no connect segment"),
        ];
        for (link, reason) in cases {
            assert_eq!(parse_connect_link(link), None, "link: {link} ({reason})");
        }
    }

    #[test]
    fn an_argv_link_fills_the_pending_slot() {
        let cases: &[(&[&str], Option<ConnectRequest>)] = &[
            (
                &["tetra-launcher.exe", "dzsa://connect/1.2.3.4:2302?fav=1"],
                Some(request("1.2.3.4", 2302, true)),
            ),
            (&["tetra-launcher.exe", "--autostart"], None),
        ];
        for (args, expected) in cases {
            let args = argv(args);
            let pending = PendingConnect::from_argv(&args);
            assert_eq!(pending.take(), expected.clone(), "argv: {args:?}");
        }
    }

    #[test]
    fn a_pending_link_is_taken_once_then_gone() {
        let pending = PendingConnect::default();
        pending.put(request("1.2.3.4", 2302, false));
        assert_eq!(pending.take(), Some(request("1.2.3.4", 2302, false)));
        assert_eq!(pending.take(), None);
    }

    #[test]
    fn a_later_pending_link_replaces_the_earlier_one() {
        let pending = PendingConnect::default();
        pending.put(request("1.2.3.4", 2302, false));
        pending.put(request("5.6.7.8", 2402, true));
        assert_eq!(pending.take(), Some(request("5.6.7.8", 2402, true)));
    }
}
