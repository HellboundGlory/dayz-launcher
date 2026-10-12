#![forbid(unsafe_code)]

//! The wire format between `tetra-indexer` (the backend that crawls Steam and
//! A2S-probes every address it finds) and the launcher, plus the HTTP client
//! the launcher uses to speak it.
//!
//! The backend is an accelerator, never a dependency: everything here is
//! designed so a client that gets no answer, a stale answer, or an answer in a
//! format it doesn't know falls back to its own Steam pass with no special
//! casing. That is why [`Snapshot::format_version`] is checked before the body
//! is trusted and why [`Health`] carries sweep timestamps rather than a bare
//! "ok".

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg(feature = "client")]
mod client;
#[cfg(feature = "client")]
pub use client::{IndexClient, IndexError, HEALTH_BACKOFF_SECS};

/// Incremented whenever a field changes meaning or disappears. A client that
/// reads a different number discards the body untouched — mismatched schemas
/// are what turn a helpful index into a source of wrong player counts.
pub const FORMAT_VERSION: u32 = 1;

/// The whole known server list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub format_version: u32,
    /// When the backend built this body.
    pub generated_at: i64,
    /// Launchers up to 2.7.0 require it and send it back to the delta address.
    pub cursor: i64,
    /// Workshop id to display name, deduplicated across every server: the
    /// same ~40 mods dominate tens of thousands of servers, so inlining names
    /// per server would multiply the payload for no information.
    pub mod_names: HashMap<u64, String>,
    pub servers: Vec<ServerEntry>,
}

/// One server, carrying every field the browser renders. Ping is absent by
/// design — it is a property of the player's connection, not of the server,
/// so the client measures its own and the backend never pretends to know it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    /// `ip:query_port`. Steam's `addr` field is the query port (verified:
    /// 94% of listed addresses answer A2S_INFO on it), and `game_port` is
    /// carried separately because that is what the game client connects to.
    pub addr: String,
    pub game_port: u16,
    pub name: String,
    pub map: String,
    pub players: i32,
    pub max_players: i32,
    pub bots: i32,
    pub locked: bool,
    pub vac: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Raw A2S keyword string. Clients re-derive the tag booleans, queue
    /// depth and in-game time from it themselves, so the classifier stays in
    /// one place instead of being frozen into the wire format.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keywords: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Declared mod load order, by workshop id — resolve names through
    /// [`Snapshot::mod_names`]. `None` means A2S_RULES has never succeeded
    /// here, which is different from "declares no mods" (`Some(vec![])`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mod_ids: Option<Vec<u64>>,
    /// When the backend's own A2S probe last got an answer. `None` means the
    /// address is listed by Steam but has never answered the backend — the
    /// client stores it and may still reach it itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_responded: Option<i64>,
    /// The backend's last verdict from its own probes. `None` when it has
    /// never probed this address, or predates the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub online: Option<bool>,
}

impl ServerEntry {
    /// Whether this entry's live fields are measurements rather than the
    /// structural zeroes of an address nobody has reached.
    pub fn responded(&self) -> bool {
        self.last_responded.is_some()
    }
}

/// Crawler freshness. A client gates on this rather than on HTTP 200: a
/// backend that is up but hasn't crawled in an hour is worse than no backend,
/// because its player counts are confidently wrong.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub format_version: u32,
    /// Indexer build version, for support questions.
    pub version: String,
    pub servers: usize,
    pub responsive: usize,
    pub with_mods: usize,
    pub populated: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_hot_pull: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_full_pull: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_info_sweep: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_rules_sweep: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_generated_at: Option<i64>,
}

impl Health {
    /// Whether the snapshot is recent enough to prefer over a Steam pass.
    /// `now` is passed in rather than read here so callers can test it.
    pub fn is_fresh(&self, now: i64, max_age_secs: i64) -> bool {
        // A day of forward clock skew is tolerated — a player's PC clock can
        // be hours off — but a stamp years ahead is refused.
        const CLOCK_SKEW_SECS: i64 = 24 * 60 * 60;
        self.format_version == FORMAT_VERSION
            && self.snapshot_generated_at.is_some_and(|t| {
                t <= now.saturating_add(CLOCK_SKEW_SECS) && now.saturating_sub(t) <= max_age_secs
            })
    }
}

/// Path of each endpoint, in one place so the client and the backend's router
/// cannot drift apart.
pub mod paths {
    pub const HEALTH: &str = "/v1/health";
    pub const SNAPSHOT: &str = "/v1/servers/snapshot";
    pub const DELTA: &str = "/v1/servers/delta";
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> ServerEntry {
        ServerEntry {
            addr: "1.2.3.4:27016".into(),
            game_port: 2302,
            name: "Survivor Haven".into(),
            map: "chernarusplus".into(),
            players: 12,
            max_players: 60,
            bots: 0,
            locked: false,
            vac: true,
            version: Some("1.29.163709".into()),
            keywords: Some("battleye,privHive".into()),
            description: None,
            mod_ids: Some(vec![1559212036]),
            last_responded: Some(1_757_000_000),
            online: Some(true),
        }
    }

    // Installed 2.7.0 launchers fail to parse a body without `cursor`.
    #[test]
    fn the_snapshot_keeps_the_fields_older_launchers_require() {
        let body = serde_json::to_value(Snapshot {
            format_version: FORMAT_VERSION,
            generated_at: 1,
            cursor: 1,
            mod_names: HashMap::new(),
            servers: vec![entry()],
        })
        .expect("serialise");
        let mut keys: Vec<&str> = body
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "cursor",
                "formatVersion",
                "generatedAt",
                "modNames",
                "servers"
            ]
        );
    }

    #[test]
    fn absent_mod_ids_survive_a_round_trip_as_none() {
        // `None` (never probed) and `Some(vec![])` (declares no mods) drive
        // different client behaviour, so the wire format must keep them apart.
        let mut never = entry();
        never.mod_ids = None;
        let mut vanilla = entry();
        vanilla.mod_ids = Some(vec![]);

        let never: ServerEntry = serde_json::from_str(&serde_json::to_string(&never).unwrap())
            .expect("never-probed round trip");
        let vanilla: ServerEntry = serde_json::from_str(&serde_json::to_string(&vanilla).unwrap())
            .expect("vanilla round trip");

        assert_eq!(never.mod_ids, None);
        assert_eq!(vanilla.mod_ids, Some(vec![]));
    }

    #[test]
    fn a_never_answered_entry_is_not_reported_as_responded() {
        let mut e = entry();
        e.last_responded = None;
        assert!(!e.responded());
        assert!(entry().responded());
    }

    #[test]
    fn health_is_stale_without_a_snapshot_or_past_the_age_limit() {
        let mut h = Health {
            format_version: FORMAT_VERSION,
            version: "test".into(),
            servers: 1,
            responsive: 1,
            with_mods: 0,
            populated: 0,
            last_hot_pull: None,
            last_full_pull: None,
            last_info_sweep: None,
            last_rules_sweep: None,
            snapshot_generated_at: None,
        };
        assert!(!h.is_fresh(1000, 600), "no snapshot is never fresh");

        h.snapshot_generated_at = Some(400);
        assert!(h.is_fresh(1000, 600));
        assert!(!h.is_fresh(1001, 600), "one second past the limit is stale");

        h.snapshot_generated_at = Some(1000 + 20 * 3600);
        assert!(h.is_fresh(1000, 600), "hours of clock skew are allowed");

        h.snapshot_generated_at = Some(1000 + 400 * 24 * 3600);
        assert!(
            !h.is_fresh(1000, 600),
            "a stamp years in the future is not fresh"
        );

        h.format_version = FORMAT_VERSION + 1;
        assert!(
            !h.is_fresh(1000, 600),
            "a schema we can't read is not fresh"
        );
    }
}
