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

/// A server as a writer sees it.
///
/// Note what is absent: `map_normalised`, `in_game_time`, and the four tag
/// booleans. Those are derived by the writer from `map` and `keywords`. A
/// caller cannot supply an inconsistent normalisation because a caller cannot
/// supply one at all.
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

#[derive(Debug, Clone, Default)]
pub struct ModRow {
    pub workshop_id: u64,
    pub name: String,
    pub install_state: Option<i64>,
    pub size_on_disk: Option<i64>,
    pub install_path: Option<String>,
}