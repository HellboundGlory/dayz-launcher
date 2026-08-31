//! Discord Rich Presence — a thin, own-thread wrapper around the local
//! Discord IPC connection. Failures are swallowed and retried, never surfaced.

use discord_rich_presence::activity::{
    Activity, Assets, Button, Party, StatusDisplayType, Timestamps,
};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

/// How often the background thread retries connecting while Discord isn't
/// reachable. Also the longest a command can wait behind a retry check.
const RECONNECT_INTERVAL: Duration = Duration::from_secs(15);

/// Where to send people who don't have the launcher yet — a button on every activity.
const DOWNLOAD_URL: &str = "https://tetralauncher.com/download";

/// The ask-to-join landing page, hands off to the `dzsa://` protocol handler —
/// so a friend can join the same server without Discord's native Ask to Join.
const JOIN_BASE_URL: &str = "https://tetralauncher.com/join";

/// The large-image asset key, uploaded once under the Discord application's
/// Rich Presence > Art Assets tab. If it was never uploaded (or uploaded
/// under a different key), Discord just omits the image — never an error.
const LOGO_ASSET_KEY: &str = "tetra-logo";

/// Small-image badge asset keys for the day/night indicator — see
/// `day_or_night`. Same graceful-omission rule as the large image.
const DAYTIME_ASSET_KEY: &str = "daytime";
const NIGHTTIME_ASSET_KEY: &str = "nighttime";

/// What a "playing" presence needs to render, captured once at launch.
/// `PartialEq` backs the dedup in `run`.
#[derive(Debug, Clone, PartialEq)]
pub struct PresenceInfo {
    pub server_name: String,
    pub map: Option<String>,
    pub players: i32,
    pub max_players: i32,
    /// Unix seconds at launch — kept fixed so Discord's elapsed-time counter doesn't reset on re-send.
    pub started_at: i64,
    /// `"HH:MM"`; drives the day/night badge, see `day_or_night`.
    pub in_game_time: Option<String>,
    pub ip: String,
    pub query_port: u16,
}

/// What the launcher is telling Discord right now, once it's more than "just
/// browsing" — mirrors `AppState::discord_now_playing` on the `src-tauri` side.
#[derive(Debug, Clone)]
pub enum DiscordSession {
    /// The pre-launch mod gate is running for this server.
    Verifying { server_name: String },
    /// DayZ is running, launched through this launcher.
    Live(PresenceInfo),
}

#[derive(Clone, PartialEq)]
enum Command {
    Idle(Option<usize>),
    Verifying(String),
    Playing(PresenceInfo),
    Clear,
}

/// Handle to the Discord presence thread. Cheap to clone; every method is
/// fire-and-forget so a broken presence connection can never affect the app.
#[derive(Clone)]
pub struct DiscordHandle {
    tx: Sender<Command>,
}

impl DiscordHandle {
    /// Starts the background thread; never blocks on Discord being reachable.
    /// `log` reports connection state *changes* only, not per-retry-tick.
    pub fn start(client_id: &str, log: impl Fn(&str) + Send + 'static) -> DiscordHandle {
        let (tx, rx) = std::sync::mpsc::channel();
        let client_id = client_id.to_string();
        std::thread::Builder::new()
            .name("tetra-discord".into())
            .spawn(move || run(&client_id, &rx, &log))
            .expect("failed to spawn tetra-discord thread");
        DiscordHandle { tx }
    }

    /// Idle: `server_count` shows as "Browsing N servers", `None` if not yet read.
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

/// Cap on a single IPC connect/write — the transport has no timeout of its own.
const IPC_OP_TIMEOUT: Duration = Duration::from_secs(5);

/// Runs `op` on a throwaway thread with a [`IPC_OP_TIMEOUT`] deadline.
/// `None` on timeout — the thread and client are abandoned, not joined,
/// since a blocked syscall can't be cancelled from safe Rust.
fn call_with_timeout<T: Send + 'static>(op: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("tetra-discord-io".into())
        .spawn(move || {
            // Receiver may already be gone if the caller timed out — that's a
            // plain Err, not a panic.
            let _ = tx.send(op());
        })
        .ok()?;
    rx.recv_timeout(IPC_OP_TIMEOUT).ok()
}

/// Thread body: owns the client and the last command, so a delayed reconnect re-applies it.
fn run(client_id: &str, rx: &Receiver<Command>, log: &impl Fn(&str)) {
    let mut client = DiscordIpcClient::new(client_id);
    let mut connected = false;
    // Edge-triggered: only the *first* failed attempt after a working
    // connection is logged, not every retry.
    let mut logged_this_outage = false;
    let mut last = Command::Idle(None);
    // The command last actually applied to the live client — `None` means
    // "nothing yet" or "just (re)connected, so re-apply regardless".
    let mut last_applied: Option<Command> = None;

    loop {
        match rx.recv_timeout(RECONNECT_INTERVAL) {
            Ok(cmd) => last = cmd,
            Err(RecvTimeoutError::Disconnected) => return,
            // Nothing new — fall through and re-apply/retry-connect below.
            Err(RecvTimeoutError::Timeout) => {}
        }

        if !connected {
            match call_with_timeout(move || {
                let mut c = client;
                let r = c.connect();
                (c, r)
            }) {
                Some((c, Ok(()))) => {
                    client = c;
                    connected = true;
                    logged_this_outage = false;
                    // Fresh connection starts with no activity set, so `last`
                    // must be reapplied even if it matches the dead client's state.
                    last_applied = None;
                    log("connected to the local client");
                    tracing::info!("discord: connected to the local client");
                }
                Some((c, Err(e))) => {
                    client = c;
                    if !logged_this_outage {
                        logged_this_outage = true;
                        log(&format!(
                            "not connected ({e}); will keep retrying every {}s",
                            RECONNECT_INTERVAL.as_secs()
                        ));
                    }
                    tracing::debug!("discord: not connected ({e}); will retry");
                    continue;
                }
                None => {
                    if !logged_this_outage {
                        logged_this_outage = true;
                        log(&format!(
                            "connect attempt did not respond within {}s; abandoning it and starting fresh",
                            IPC_OP_TIMEOUT.as_secs()
                        ));
                    }
                    client = DiscordIpcClient::new(client_id);
                    continue;
                }
            }
        }

        // Skip the round trip when `last` is exactly what's already showing.
        if !needs_apply(&last_applied, &last) {
            continue;
        }

        let to_apply = last.clone();
        match call_with_timeout(move || {
            let mut c = client;
            let r = apply(&mut c, &to_apply);
            (c, r)
        }) {
            Some((c, Ok(()))) => {
                client = c;
                last_applied = Some(last.clone());
            }
            Some((c, Err(e))) => {
                client = c;
                log(&format!("lost connection ({e}); will reconnect"));
                tracing::debug!("discord: lost connection ({e}); will reconnect");
                let _ = client.close();
                connected = false;
            }
            None => {
                log(&format!(
                    "presence update did not respond within {}s; abandoning the connection and reconnecting",
                    IPC_OP_TIMEOUT.as_secs()
                ));
                client = DiscordIpcClient::new(client_id);
                connected = false;
            }
        }
    }
}

/// Split out so the dedup is testable without a real Discord IPC socket.
fn needs_apply(last_applied: &Option<Command>, candidate: &Command) -> bool {
    last_applied.as_ref() != Some(candidate)
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
/// badge for the caller to add) and the `Details` field.
fn base_activity<'a>(state: &'a str, details: String) -> Activity<'a> {
    Activity::new()
        .state(state)
        .details(details)
        .assets(
            Assets::new()
                .large_image(LOGO_ASSET_KEY)
                .large_text("Tetra Launcher"),
        )
        .buttons(vec![Button::new("Get Tetra Launcher", DOWNLOAD_URL)])
        // Compact one-line summary shown in space-constrained spots; `Details`
        // is the only field that differs between players.
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
        .buttons(vec![
            Button::new("Join via Tetra Launcher", join_url(info)),
            Button::new("Get Tetra Launcher", DOWNLOAD_URL),
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

/// The join-landing-page URL for this server, with the server name and map
/// percent-encoded — DayZ server names routinely carry spaces, brackets, and emoji.
fn join_url(info: &PresenceInfo) -> String {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    // IP is already structurally safe (digits and dots), so left unencoded.
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

/// Daytime = 06:00–19:59; keep in sync by hand with `DAY_START`/`DAY_END`
/// in `src/lib/utils.ts::formatGameTime`.
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
            "https://tetralauncher.com/join\
             ?ip=51.254.46.15&port=2303&name=GulagZ&map=Chernarus"
        );
    }

    #[test]
    fn join_url_percent_encodes_special_characters_in_the_name() {
        let mut i = info(1, 2);
        i.server_name = "RU FAN|MOD [PVP] 🔥".into();
        let url = join_url(&i);
        assert!(!url.contains(' ') && !url.contains('|') && !url.contains('['));
        assert!(url.contains("name=RU%20FAN%7CMOD%20%5BPVP%5D%20"));
    }

    #[test]
    fn an_unchanged_command_does_not_need_reapplying() {
        let cmd = Command::Playing(info(12, 60));
        assert!(!needs_apply(&Some(cmd.clone()), &cmd));
    }

    #[test]
    fn a_changed_field_does_need_reapplying() {
        let before = Command::Playing(info(12, 60));
        let after = Command::Playing(info(13, 60));
        assert!(needs_apply(&Some(before), &after));
    }

    #[test]
    fn nothing_applied_yet_always_needs_applying() {
        assert!(needs_apply(&None, &Command::Idle(None)));
    }

    #[test]
    fn a_different_command_kind_needs_reapplying() {
        assert!(needs_apply(
            &Some(Command::Idle(Some(5))),
            &Command::Verifying("GulagZ".into())
        ));
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
