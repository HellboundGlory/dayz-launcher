use std::net::Ipv4Addr;
use tetra_core::a2s::info::ServerInfo;
use tetra_core::PingKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ServerKey {
    pub ip: Ipv4Addr,
    pub query_port: u16,
}

impl Default for ServerKey {
    fn default() -> Self {
        Self {
            ip: Ipv4Addr::UNSPECIFIED,
            query_port: 0,
        }
    }
}

/// A server as a writer sees it. `map_normalised`, `in_game_time`, and the
/// tag booleans are absent — the writer derives them from `map`/`keywords`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerRow {
    pub key: ServerKey,
    pub game_port: u16,
    pub name: String,
    pub map: String,
    pub players: i32,
    pub max_players: i32,
    pub bots: i32,
    pub ping_ms: i32,
    /// Where `ping_ms` came from, so a row can be marked as an estimate.
    pub ping_kind: PingKind,
    pub locked: bool,
    pub vac: bool,
    pub version: Option<String>,
    pub keywords: Option<String>,
    pub description: Option<String>,
    pub mod_count: Option<i32>,
    pub last_played: Option<i64>,
    /// `true` records a successful A2S response now. Steam-sourced rows that
    /// were never directly queried set this `false`.
    pub responded: bool,
    /// The answer time to store when `responded` is `true`; `None` means now.
    pub responded_at: Option<i64>,
    /// A verdict to store with the row. `None` leaves the stored flag alone;
    /// an index row carries the backend's, a probe records its own separately.
    pub online: Option<bool>,
    /// When `online` was reached, on this PC's clock. Without it, a verdict
    /// from elsewhere is weighed against the row's last answer instead.
    pub online_checked_at: Option<i64>,
    /// Two-letter ISO country code derived from the IP address via GeoIP.
    /// Populated automatically by the writer during upsert; callers should
    /// leave this `None`.
    pub country_code: Option<String>,
}

impl ServerRow {
    /// The row for a live A2S_INFO answer. `ping_ms` is `None` when the server
    /// was never pinged, which stores `0` and reads back as measured. A caller
    /// with a wider number caps it before passing it in.
    pub fn from_info(
        key: ServerKey,
        info: ServerInfo,
        ping_ms: Option<i32>,
        ping_kind: PingKind,
    ) -> ServerRow {
        ServerRow {
            key,
            game_port: info.game_port.unwrap_or(0),
            name: info.name,
            map: info.map,
            players: i32::from(info.players),
            max_players: i32::from(info.max_players),
            bots: i32::from(info.bots),
            ping_ms: ping_ms.unwrap_or(0),
            ping_kind,
            locked: info.visibility != 0,
            vac: info.vac != 0,
            version: Some(info.version),
            keywords: info.keywords,
            description: None,
            // Owned exclusively by `upsert_server_mods`; writing `None` here
            // would clobber a stored count through its COALESCE fallback.
            mod_count: None,
            last_played: None,
            responded: true,
            responded_at: None,
            online: None,
            online_checked_at: None,
            country_code: None,
        }
    }
}

/// A stored server as an exporter sees it: every field a browser renders,
/// including the declared mod list, and nothing derived that a consumer can
/// recompute from `keywords`/`map` itself.
///
/// Distinct from [`ServerRow`] (what a writer supplies) and from
/// `filter::ServerListRow` (what a table renders): this is the shape that
/// crosses a machine boundary, so it carries the raw fields rather than this
/// build's interpretation of them.
#[derive(Debug, Clone)]
pub struct ExportRow {
    pub key: ServerKey,
    pub game_port: u16,
    pub name: String,
    pub map: String,
    pub players: i32,
    pub max_players: i32,
    pub bots: i32,
    pub locked: bool,
    pub vac: bool,
    pub version: Option<String>,
    pub keywords: Option<String>,
    pub description: Option<String>,
    /// Declared load order by workshop id. `None` means A2S_RULES has never
    /// succeeded here — not "declares no mods", which is `Some(vec![])`.
    pub mod_ids: Option<Vec<u64>>,
    pub last_responded: Option<i64>,
    /// The backend's own verdict; `None` until it has probed the address.
    pub online: Option<bool>,
    /// When `online` was last written from the backend's own probe; `None`
    /// until it has probed the address since the column existed.
    pub online_checked_at: Option<i64>,
}

/// [`Reader::export`](crate::Reader::export)'s result: rows plus the one copy
/// of each mod name they reference. Names are interned because the same few
/// dozen mods appear on tens of thousands of servers.
#[derive(Debug, Clone, Default)]
pub struct Export {
    pub rows: Vec<ExportRow>,
    pub mod_names: std::collections::HashMap<u64, String>,
}

/// Cached workshop item metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WorkshopCacheRow {
    pub workshop_id: u64,
    pub title: String,
    pub file_size: u64,
    pub preview_url: Option<String>,
    pub time_updated: u64,
    pub cached_at: i64,
}
