//! Discord Rich Presence — a thin, own-thread wrapper around the local
//! Discord IPC connection.
//!
//! Mirrors `tetra-steam`'s actor pattern: the underlying client
//! (`discord-rich-presence`'s `DiscordIpcClient`) is synchronous and talks to
//! a local socket, so it gets a dedicated thread and a channel rather than
//! being touched from async code directly. Unlike Steam, there is no hard
//! requirement here — Discord may not be running at all, may not be running
//! *yet*, or may close mid-session — so every failure is swallowed and
//! retried rather than surfaced as an error the rest of the app has to
//! handle. A player without Discord installed must see nothing different.

use discord_rich_presence::activity::{
    Activity, Assets, Button, Party, StatusDisplayType, Timestamps,
};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

/// How often the background thread retries connecting while Discord isn't
/// reachable. Also the longest a command can wait behind a retry check.
const RECONNECT_INTERVAL: Duration = Duration::from_secs(15);

/// Where to send people who don't have the launcher yet — a button on every
/// activity.
const RELEASES_URL: &str = "https://github.com/HellboundGlory/dayz-launcher/releases/latest";

/// The ask-to-join landing page (`docs/join.html`, served over GitHub
/// Pages at the project's custom domain) — hands off to the `dzsa://`
/// protocol handler. The second button on a "playing" activity, so a
/// friend can land on the same server in one click without Discord's
/// native (and, for a non-detected app, unreliable) Ask to Join.
const JOIN_BASE_URL: &str = "https://tetralauncher.com/join.html";

/// The large-image asset key, uploaded once under the Discord application's
/// Rich Presence > Art Assets tab. If it was never uploaded (or uploaded
/// under a different key), Discord just omits the image — never an error.
const LOGO_ASSET_KEY: &str = "tetra-logo";

/// Small-image badge asset keys for the day/night indicator — see
/// `day_or_night`. Same graceful-omission rule as the large image.
const DAYTIME_ASSET_KEY: &str = "daytime";
const NIGHTTIME_ASSET_KEY: &str = "nighttime";

/// What a "playing" presence needs to render. Everything the caller has to
/// hand right after a launch — nothing here is re-queried live.
#[derive(Debug, Clone)]
pub struct PresenceInfo {
    pub server_name: String,
    pub map: Option<String>,
    pub players: i32,
    pub max_players: i32,
    /// Unix seconds when the session started — set once at launch and
    /// carried through every re-send, so Discord's elapsed-time counter
    /// does not reset on the next poll tick.
    pub started_at: i64,
    /// The server's reported in-game clock, `"HH:MM"` — not every server
    /// includes this in its keywords, so `None` is ordinary. Drives the
    /// day/night badge; see `day_or_night`.
    pub in_game_time: Option<String>,
    /// The server's A2S address — carried only so `join_url` can build the
    /// landing-page link; nothing here reads it as a display value.
    pub ip: String,
    pub query_port: u16,
}

/// What the launcher is telling Discord right now, once it is more than
/// "just browsing" — mirrors `AppState::discord_now_playing` on the
/// `src-tauri` side, which owns picking between these.
#[derive(Debug, Clone)]
pub enum DiscordSession {
    /// The pre-launch mod gate is running for this server. No party or
    /// timestamp yet — nothing has actually started.
    Verifying { server_name: String },
    /// DayZ is running, launched through this launcher.
    Live(PresenceInfo),
}

#[derive(Clone)]
enum Command {
    Idle(Option<usize>),
    Verifying(String),
    Playing(PresenceInfo),
    Clear,
}

/// Handle to the Discord presence thread.
///
/// Cheap to clone (it is just a channel sender). Every method is
/// fire-and-forget: a full mailbox, a dead thread, or Discord not running are
/// all the same "nothing happens" from the caller's side, because a broken
/// presence connection must never be why a command — or the app itself —
/// misbehaves.
#[derive(Clone)]
pub struct DiscordHandle {
    tx: Sender<Command>,
}

impl DiscordHandle {
    /// Start the background thread and return a handle to it.
    ///
    /// Never blocks on Discord being reachable: connecting (and retrying)
    /// happens entirely off this call, on the spawned thread.
    pub fn start(client_id: &str) -> DiscordHandle {
        let (tx, rx) = std::sync::mpsc::channel();
        let client_id = client_id.to_string();
        std::thread::Builder::new()
            .name("tetra-discord".into())
            .spawn(move || run(&client_id, &rx))
            .expect("failed to spawn tetra-discord thread");
        DiscordHandle { tx }
    }

    /// Nothing is running through the launcher right now. `server_count` is
    /// the current registry size, shown as "Browsing N servers" — `None`
    /// while it hasn't been read yet.
    pub fn set_idle(&self, server_count: Option<usize>) {
        let _ = self.tx.send(Command::Idle(server_count));
    }

    /// The pre-launch mod gate is running for `server_name`.
    pub fn set_verifying(&self, server_name: String) {
        let _ = self.tx.send(Command::Verifying(server_name));
    }

    /// A session the launcher started is live.
    pub fn set_playing(&self, info: PresenceInfo) {
        let _ = self.tx.send(Command::Playing(info));
    }

    /// Remove the activity entirely (used when the user turns the feature
    /// off in Settings).
    pub fn clear(&self) {
        let _ = self.tx.send(Command::Clear);
    }
}

/// The thread body. Holds the only `DiscordIpcClient` and the last command it
/// was told to apply, so a delayed (re)connect still ends up showing the
/// right thing instead of whatever the client happened to start as.
fn run(client_id: &str, rx: &Receiver<Command>) {
    let mut client = DiscordIpcClient::new(client_id);
    let mut connected = false;
    let mut last = Command::Idle(None);

    loop {
        match rx.recv_timeout(RECONNECT_INTERVAL) {
            Ok(cmd) => last = cmd,
            Err(RecvTimeoutError::Disconnected) => return,
            // Nothing new — fall through and re-apply/retry-connect below.
            Err(RecvTimeoutError::Timeout) => {}
        }

        if !connected {
            match client.connect() {
                Ok(()) => {
                    connected = true;
                    tracing::info!("discord: connected to the local client");
                }
                Err(e) => {
                    tracing::debug!("discord: not connected ({e}); will retry");
                    continue;
                }
            }
        }

        if let Err(e) = apply(&mut client, &last) {
            tracing::debug!("discord: lost connection ({e}); will reconnect");
            let _ = client.close();
            connected = false;
        }
    }
}

fn apply(
    client: &mut DiscordIpcClient,
    cmd: &Command,
) -> Result<(), discord_rich_presence::error::Error> {
    match cmd {
        Command::Clear => client.clear_activity(),
        Command::Idle(count) => client.set_activity(idle_activity(*count)),
        Command::Verifying(server_name) => client.set_activity(verifying_activity(server_name)),
        Command::Playing(info) => client.set_activity(playing_activity(info)),
    }
}

/// Shared across every activity: the assets block (logo, plus a day/night
/// badge for the caller to add) and the `Details` field carrying whatever
/// this activity's identifying text is — see the module-level note on the
/// `state`/`details` split.
fn base_activity<'a>(state: &'a str, details: String) -> Activity<'a> {
    Activity::new()
        .state(state)
        .details(details)
        .assets(
            Assets::new()
                .large_image(LOGO_ASSET_KEY)
                .large_text("Tetra Launcher"),
        )
        .buttons(vec![Button::new("Get Tetra Launcher", RELEASES_URL)])
        // Controls the compact one-line summary Discord shows in space-
        // constrained spots (a server's member list, mainly) — never the
        // full profile card, which always shows everything regardless.
        // `Details` is the only one of the three fields that differs
        // between players; `Name`/`State` would show the same static text
        // for everyone.
        .status_display_type(StatusDisplayType::Details)
}

fn idle_activity<'a>(server_count: Option<usize>) -> Activity<'a> {
    let details = match server_count {
        Some(n) => format!("{n} servers"),
        None => "servers".to_string(),
    };
    base_activity("Browsing", details)
}

fn verifying_activity(server_name: &str) -> Activity<'_> {
    base_activity("Checking mods", server_name.to_string())
}

fn playing_activity(info: &PresenceInfo) -> Activity<'_> {
    let mut activity = base_activity("Playing", details_text(info))
        // Discord wants milliseconds; `PresenceInfo::started_at` is seconds.
        .timestamps(Timestamps::new().start(info.started_at * 1000))
        // Overrides `base_activity`'s single button — a friend who already
        // has the launcher wants the first one; `Get Tetra Launcher` stays
        // as the fallback for one who doesn't.
        .buttons(vec![
            Button::new("Join via Tetra Launcher", join_url(info)),
            Button::new("Get Tetra Launcher", RELEASES_URL),
        ]);
    if let Some([current, max]) = party_size(info) {
        activity = activity.party(Party::new().size([current, max]));
    }
    if let Some(is_day) = info.in_game_time.as_deref().and_then(day_or_night) {
        let (key, text) = if is_day {
            (DAYTIME_ASSET_KEY, "Daytime")
        } else {
            (NIGHTTIME_ASSET_KEY, "Night")
        };
        activity = activity.assets(
            Assets::new()
                .large_image(LOGO_ASSET_KEY)
                .large_text("Tetra Launcher")
                .small_image(key)
                .small_text(text),
        );
    }
    activity
}

/// "Server Name — Map", or just the name if the map is blank.
fn details_text(info: &PresenceInfo) -> String {
    match info.map.as_deref() {
        Some(map) if !map.trim().is_empty() => format!("{} — {}", info.server_name, map),
        _ => info.server_name.clone(),
    }
}

/// The `docs/join.html` landing-page URL for this server, with the server
/// name and map percent-encoded — DayZ server names routinely carry spaces,
/// brackets, and emoji, none of which belong raw in a query string.
fn join_url(info: &PresenceInfo) -> String {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    // The IP is already structurally known-safe (digits and dots), so it is
    // interpolated as-is rather than through the same aggressive encoder as
    // the free-text fields below — encoding it would only turn every `.`
    // into `%2E`, which is legal but needless noise in the URL.
    let mut url = format!(
        "{JOIN_BASE_URL}?ip={}&port={}&name={}",
        info.ip,
        info.query_port,
        utf8_percent_encode(&info.server_name, NON_ALPHANUMERIC),
    );
    if let Some(map) = info.map.as_deref().filter(|m| !m.trim().is_empty()) {
        url.push_str("&map=");
        url.push_str(&utf8_percent_encode(map, NON_ALPHANUMERIC).to_string());
    }
    url
}

/// Discord's party display, clamped to sane bounds. `None` when there is
/// nothing meaningful to show (a server with no reported capacity).
fn party_size(info: &PresenceInfo) -> Option<[i32; 2]> {
    if info.max_players <= 0 {
        return None;
    }
    Some([info.players.clamp(0, info.max_players), info.max_players])
}

/// Whether a server's reported in-game clock (`"HH:MM"`, 24-hour) falls in
/// daytime. `None` for anything that doesn't parse as a plausible clock
/// time — malformed input shows no badge rather than a guessed one.
///
/// The boundary (06:00–19:59 inclusive = day) is a fixed approximation, not
/// a simulation of any particular server's actual day/night multipliers —
/// there is no sunrise/sunset data to work from, only the clock reading.
fn day_or_night(hhmm: &str) -> Option<bool> {
    let (h, m) = hhmm.split_once(':')?;
    let hour: u32 = h.parse().ok()?;
    let minute: u32 = m.parse().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    Some((6..20).contains(&hour))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(players: i32, max_players: i32) -> PresenceInfo {
        PresenceInfo {
            server_name: "GulagZ".into(),
            map: Some("Chernarus".into()),
            players,
            max_players,
            started_at: 0,
            in_game_time: None,
            ip: "51.254.46.15".into(),
            query_port: 2303,
        }
    }

    #[test]
    fn details_combines_name_and_map() {
        assert_eq!(details_text(&info(1, 2)), "GulagZ — Chernarus");
    }

    #[test]
    fn a_blank_map_falls_back_to_the_name_alone() {
        let mut i = info(1, 2);
        i.map = Some("".into());
        assert_eq!(details_text(&i), "GulagZ");
        i.map = None;
        assert_eq!(details_text(&i), "GulagZ");
    }

    #[test]
    fn party_size_reflects_the_server() {
        assert_eq!(party_size(&info(12, 60)), Some([12, 60]));
    }

    #[test]
    fn an_unreported_capacity_shows_no_party() {
        assert_eq!(party_size(&info(0, 0)), None);
    }

    #[test]
    fn a_player_count_past_capacity_is_clamped() {
        // Steam's browser data can be momentarily inconsistent (e.g. a
        // player who just left not yet reflected in max). Discord rejects a
        // party larger than its own stated size outright, so this clamps
        // rather than passing an inconsistent count through.
        assert_eq!(party_size(&info(70, 60)), Some([60, 60]));
    }

    #[test]
    fn midday_and_midnight_are_unambiguous() {
        assert_eq!(day_or_night("13:23"), Some(true));
        assert_eq!(day_or_night("00:00"), Some(false));
    }

    #[test]
    fn the_boundary_hours_land_on_the_documented_side() {
        assert_eq!(day_or_night("05:59"), Some(false));
        assert_eq!(day_or_night("06:00"), Some(true));
        assert_eq!(day_or_night("19:59"), Some(true));
        assert_eq!(day_or_night("20:00"), Some(false));
    }

    #[test]
    fn malformed_clocks_show_no_badge_rather_than_a_guess() {
        assert_eq!(day_or_night(""), None);
        assert_eq!(day_or_night("not a time"), None);
        assert_eq!(day_or_night("25:00"), None);
        assert_eq!(day_or_night("12:99"), None);
        assert_eq!(day_or_night("12"), None);
    }

    #[test]
    fn join_url_carries_the_address_and_name() {
        let url = join_url(&info(1, 2));
        assert_eq!(
            url,
            "https://tetralauncher.com/join.html\
             ?ip=51.254.46.15&port=2303&name=GulagZ&map=Chernarus"
        );
    }

    #[test]
    fn join_url_percent_encodes_special_characters_in_the_name() {
        let mut i = info(1, 2);
        i.server_name = "RU FAN|MOD [PVP] 🔥".into();
        let url = join_url(&i);
        // No raw space, pipe, bracket or emoji byte should reach the query
        // string — a server name is player-controlled text landing straight
        // in a URL.
        assert!(!url.contains(' ') && !url.contains('|') && !url.contains('['));
        assert!(url.contains("name=RU%20FAN%7CMOD%20%5BPVP%5D%20"));
    }

    #[test]
    fn join_url_omits_a_blank_map() {
        let mut i = info(1, 2);
        i.map = None;
        assert!(!join_url(&i).contains("map="));
        i.map = Some("".into());
        assert!(!join_url(&i).contains("map="));
    }
}
