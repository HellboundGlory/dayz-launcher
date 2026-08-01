use std::net::Ipv4Addr;
use tetra_registry::rows::{ServerKey, ServerRow};

/// A Steam server-list row, owned and `Send`.
///
/// `steamworks::GameServerItem` is produced inside a callback on the Steam
/// thread and cannot cross a thread boundary, so it is copied into this before
/// leaving the actor.
#[derive(Debug, Clone)]
pub struct GameServerRow {
    pub ip: Ipv4Addr,
    pub query_port: u16,
    pub game_port: u16,
    pub name: String,
    pub map: String,
    pub players: i32,
    pub max_players: i32,
    pub bots: i32,
    pub ping_ms: i32,
    pub locked: bool,
    pub vac: bool,
    pub server_version: i32,
    pub description: String,
    pub tags: String,
    pub last_played: Option<i64>,
    pub responded: bool,
}

pub fn to_server_row(g: &GameServerRow) -> ServerRow {
    ServerRow {
        key: ServerKey {
            ip: g.ip,
            query_port: g.query_port,
        },
        game_port: g.game_port,
        name: g.name.clone(),
        map: g.map.clone(),
        players: g.players,
        max_players: g.max_players,
        bots: g.bots,
        ping_ms: g.ping_ms,
        locked: g.locked,
        vac: g.vac,
        version: (g.server_version != 0).then(|| g.server_version.to_string()),
        keywords: (!g.tags.is_empty()).then(|| g.tags.clone()),
        description: (!g.description.is_empty()).then(|| g.description.clone()),
        mod_count: None,
        last_played: g.last_played,
        responded: g.responded,
        country_code: None,
    }
}