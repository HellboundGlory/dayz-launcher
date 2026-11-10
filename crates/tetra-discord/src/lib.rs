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
    Verifying {
        server_name: String,
        show_server: bool,
    },
    Playing {
        info: PresenceInfo,
        show_server: bool,
    },
    Clear,
}

impl Command {
    /// A private session drops what it hides, so a hidden change (player count,
    /// a different server) is not sent to Discord again.
    fn playing(info: PresenceInfo, show_server: bool) -> Self {
        let info = if show_server {
            info
        } else {
            PresenceInfo {
                server_name: String::new(),
                map: None,
                players: 0,
                max_players: 0,
                started_at: info.started_at,
                in_game_time: None,
                ip: String::new(),
                query_port: 0,
            }
        };
        Command::Playing { info, show_server }
    }

    fn verifying(server_name: String, show_server: bool) -> Self {
        Command::Verifying {
            server_name: if show_server {
                server_name
            } else {
                String::new()
            },
            show_server,
        }
    }
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

    /// The pre-launch mod gate is running for `server_name`. `show_server` off
    /// hides the server, leaving only that DayZ is being checked.
    pub fn set_verifying(&self, server_name: String, show_server: bool) {
        let _ = self.tx.send(Command::verifying(server_name, show_server));
    }

    /// A session the launcher started is live. `show_server` off hides the
    /// server name, map, player count and join button.
    pub fn set_playing(&self, info: PresenceInfo, show_server: bool) {
        let _ = self.tx.send(Command::playing(info, show_server));
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
        Command::Verifying {
            server_name,
            show_server,
        } => client.set_activity(verifying_activity(server_name, *show_server)),
        Command::Playing { info, show_server } => {
            client.set_activity(playing_activity(info, *show_server))
        }
    }
}

/// Shared across every activity: the assets block (the logo) and the
/// `Details` field. Buttons belong to the caller.
fn base_activity<'a>(state: &'a str, details: String) -> Activity<'a> {
    Activity::new()
        .state(state)
        .details(details)
        .assets(
            Assets::new()
                .large_image(LOGO_ASSET_KEY)
                .large_text("Tetra Launcher"),
        )
        // Compact one-line summary shown in space-constrained spots; `Details`
        // is the only field that differs between players.
        .status_display_type(StatusDisplayType::Details)
}

fn download_button() -> Button<'static> {
    Button::new("Get Tetra Launcher", DOWNLOAD_URL)
}

fn idle_activity(server_count: Option<usize>) -> Activity<'static> {
    let details = match server_count {
        Some(n) => format!("{n} servers"),
        None => "servers".to_string(),
    };
    activity_from(PresenceText {
        state: "Browsing",
        details,
        started_at_ms: None,
        party: None,
        join_url: None,
        badge: None,
    })
}

/// The visible text of a presence, built without a Discord connection so the
/// full and private forms can be compared in tests.
#[derive(Debug, PartialEq)]
struct PresenceText {
    state: &'static str,
    details: String,
    /// Unix milliseconds, as Discord wants them.
    started_at_ms: Option<i64>,
    party: Option<[i32; 2]>,
    join_url: Option<String>,
    /// The day/night badge: its asset key and hover text.
    badge: Option<(&'static str, &'static str)>,
}

fn verifying_presence(server_name: &str, show_server: bool) -> PresenceText {
    PresenceText {
        state: "Checking mods",
        details: if show_server {
            server_name.to_string()
        } else {
            "DayZ".to_string()
        },
        started_at_ms: None,
        party: None,
        join_url: None,
        badge: None,
    }
}

fn playing_presence(info: &PresenceInfo, show_server: bool) -> PresenceText {
    let started_at_ms = Some(info.started_at * 1000);
    if !show_server {
        return PresenceText {
            state: "Playing",
            details: "DayZ".to_string(),
            started_at_ms,
            party: None,
            join_url: None,
            badge: None,
        };
    }
    PresenceText {
        state: "Playing",
        details: details_text(info),
        started_at_ms,
        party: party_size(info),
        join_url: Some(join_url(info)),
        badge: info
            .in_game_time
            .as_deref()
            .and_then(day_or_night)
            .map(|is_day| {
                if is_day {
                    (DAYTIME_ASSET_KEY, "Daytime")
                } else {
                    (NIGHTTIME_ASSET_KEY, "Night")
                }
            }),
    }
}

fn activity_from(presence: PresenceText) -> Activity<'static> {
    let mut activity = base_activity(presence.state, presence.details);
    if let Some(start) = presence.started_at_ms {
        activity = activity.timestamps(Timestamps::new().start(start));
    }
    let mut buttons = Vec::with_capacity(2);
    if let Some(url) = presence.join_url {
        buttons.push(Button::new("Join via Tetra Launcher", url));
    }
    buttons.push(download_button());
    activity = activity.buttons(buttons);
    if let Some([current, max]) = presence.party {
        activity = activity.party(Party::new().size([current, max]));
    }
    if let Some((key, text)) = presence.badge {
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

fn verifying_activity(server_name: &str, show_server: bool) -> Activity<'static> {
    activity_from(verifying_presence(server_name, show_server))
}

fn playing_activity(info: &PresenceInfo, show_server: bool) -> Activity<'static> {
    activity_from(playing_presence(info, show_server))
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
    fn details_text_names_the_map_only_when_the_server_reports_one() {
        let cases: &[(Option<&str>, &str)] = &[
            (Some("Chernarus"), "GulagZ — Chernarus"),
            (Some(""), "GulagZ"),
            (None, "GulagZ"),
        ];
        for (map, expected) in cases {
            let mut i = info(1, 2);
            i.map = map.map(|m| m.to_string());
            assert_eq!(details_text(&i), *expected, "map: {map:?}");
        }
    }

    #[test]
    fn party_size_shows_the_server_count_clamped_to_its_capacity() {
        let cases = [
            (12, 60, Some([12, 60])),
            // Nothing to show when no capacity was reported.
            (0, 0, None),
            (70, 60, Some([60, 60])),
        ];
        for (players, max_players, expected) in cases {
            assert_eq!(
                party_size(&info(players, max_players)),
                expected,
                "players={players}, max_players={max_players}"
            );
        }
    }

    #[test]
    fn day_or_night_reads_a_clock_and_refuses_anything_else() {
        let cases: &[(&str, Option<bool>)] = &[
            ("13:23", Some(true)),
            ("00:00", Some(false)),
            // Day runs 06:00–19:59.
            ("05:59", Some(false)),
            ("06:00", Some(true)),
            ("19:59", Some(true)),
            ("20:00", Some(false)),
            ("", None),
            ("not a time", None),
            ("25:00", None),
            ("12:99", None),
            ("12", None),
        ];
        for (hhmm, expected) in cases {
            assert_eq!(day_or_night(hhmm), *expected, "clock: {hhmm:?}");
        }
    }

    #[test]
    fn join_url_carries_the_address_and_the_map_when_there_is_one() {
        let url = join_url(&info(1, 2));
        assert_eq!(
            url,
            "https://tetralauncher.com/join\
             ?ip=51.254.46.15&port=2303&name=GulagZ&map=Chernarus"
        );

        let mut without_map = info(1, 2);
        without_map.map = None;
        assert!(!join_url(&without_map).contains("map="));
        without_map.map = Some("".into());
        assert!(!join_url(&without_map).contains("map="));
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
    fn only_a_changed_command_is_reapplied() {
        let playing = |info| Command::Playing {
            info,
            show_server: true,
        };
        let cases: [(&str, Option<Command>, Command, bool); 4] = [
            (
                "unchanged",
                Some(playing(info(12, 60))),
                playing(info(12, 60)),
                false,
            ),
            (
                "changed field",
                Some(playing(info(12, 60))),
                playing(info(13, 60)),
                true,
            ),
            ("nothing applied yet", None, Command::Idle(None), true),
            (
                "different kind",
                Some(Command::Idle(Some(5))),
                Command::Verifying {
                    server_name: "GulagZ".into(),
                    show_server: true,
                },
                true,
            ),
        ];
        for (label, before, after, expected) in cases {
            assert_eq!(needs_apply(&before, &after), expected, "{label}");
        }
    }

    #[test]
    fn switching_show_server_on_the_same_session_counts_as_changed() {
        let before = Command::Playing {
            info: info(12, 60),
            show_server: true,
        };
        let after = Command::Playing {
            info: info(12, 60),
            show_server: false,
        };
        assert!(needs_apply(&Some(before), &after));
    }

    #[test]
    fn a_private_presence_is_not_resent_when_only_hidden_details_change() {
        assert!(!needs_apply(
            &Some(Command::playing(info(12, 60), false)),
            &Command::playing(info(13, 60), false)
        ));
        assert!(!needs_apply(
            &Some(Command::verifying("GulagZ".into(), false)),
            &Command::verifying("Namalsk".into(), false)
        ));
        assert!(needs_apply(
            &Some(Command::playing(info(12, 60), true)),
            &Command::playing(info(13, 60), true)
        ));
    }

    #[test]
    fn a_private_playing_presence_names_only_the_game() {
        let shown = playing_presence(&info(12, 60), true);
        assert_eq!(shown.details, "GulagZ — Chernarus");
        assert_eq!(shown.party, Some([12, 60]));
        assert!(shown.join_url.is_some());

        let private = playing_presence(&info(12, 60), false);
        assert_eq!(private.state, "Playing");
        assert_eq!(private.details, "DayZ");
        assert_eq!(private.party, None);
        assert_eq!(private.join_url, None);
        assert_eq!(private.badge, None);
        assert_eq!(private.started_at_ms, shown.started_at_ms);
    }

    #[test]
    fn a_private_verifying_presence_names_only_the_game() {
        assert_eq!(verifying_presence("GulagZ", true).details, "GulagZ");

        let private = verifying_presence("GulagZ", false);
        assert_eq!(private.state, "Checking mods");
        assert_eq!(private.details, "DayZ");
    }
}
