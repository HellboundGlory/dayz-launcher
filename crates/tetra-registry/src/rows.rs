use std::net::Ipv4Addr;

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
#[derive(Debug, Clone, Default)]
pub struct ServerRow {
    pub key: ServerKey,
    pub game_port: u16,
    pub name: String,
    pub map: String,
    pub players: i32,
    pub max_players: i32,
    pub bots: i32,
    pub ping_ms: i32,
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
    /// Two-letter ISO country code derived from the IP address via GeoIP.
    /// Populated automatically by the writer during upsert; callers should
    /// leave this `None`.
    pub country_code: Option<String>,
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
    pub last_seen: i64,
    pub last_responded: Option<i64>,
}

/// [`Reader::export`](crate::Reader::export)'s result: rows plus the one copy
/// of each mod name they reference. Names are interned because the same few
/// dozen mods appear on tens of thousands of servers.
#[derive(Debug, Clone, Default)]
pub struct Export {
    pub rows: Vec<ExportRow>,
    pub mod_names: std::collections::HashMap<u64, String>,
}
