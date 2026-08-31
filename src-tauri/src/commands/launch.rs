use crate::commands::settings::OnJoin;
use crate::state::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use tetra_launch::modline::build_mod_string;
use tetra_launch::protocol::register_dzsa_protocol;
use tetra_launch::spawn::{build_launch_args, find_dayz_exe, spawn_dayz};
use tetra_steam::workshop::ModState;

/// Whether an A2S_RULES failure means the server started answering and then
/// stopped, rather than never responding at all.
fn stalled_mid_response(e: &tetra_net::NetError) -> bool {
    matches!(e, tetra_net::NetError::ExchangeTimedOut { .. })
}

/// Turn the blocked mods into one message that says what to actually do,
/// grouped by cause ("not installed" vs "needs updating" want different actions).
fn describe_blockers(blocked: &[(String, ModState)]) -> String {
    fn names(blocked: &[(String, ModState)], want: ModState) -> Vec<&str> {
        blocked
            .iter()
            .filter(|(_, s)| *s == want)
            .map(|(n, _)| n.as_str())
            .collect()
    }

    // Long mod lists produce unreadable errors, so name a few and count the rest.
    fn list(names: &[&str]) -> String {
        const SHOWN: usize = 5;
        if names.len() <= SHOWN {
            return names.join(", ");
        }
        format!(
            "{}, and {} more",
            names[..SHOWN].join(", "),
            names.len() - SHOWN
        )
    }

    let mut parts: Vec<String> = Vec::new();

    for (state, phrasing) in [
        (ModState::Downloading, "still downloading"),
        (ModState::NeedsUpdate, "need updating"),
        (ModState::NotInstalled, "not downloaded yet"),
        (ModState::NotSubscribed, "not subscribed"),
    ] {
        let group = names(blocked, state);
        if !group.is_empty() {
            parts.push(format!("{} {}: {}", group.len(), phrasing, list(&group)));
        }
    }

    let advice = if blocked.iter().any(|(_, s)| *s == ModState::Downloading) {
        " Wait for the downloads to finish, then try again."
    } else {
        " Subscribe to them on the Steam Workshop and let Steam finish downloading."
    };

    format!("Cannot join — {}.{advice}", parts.join("; "))
}

#[derive(serde::Serialize)]
pub struct SteamPaths {
    pub steam_install: String,
    pub dayz_install: String,
    pub workshop_dir: String,
}

#[derive(serde::Serialize)]
pub struct LaunchOutcome {
    pub status: String,
    pub mods_checked: usize,
    pub mods_ready: usize,
    pub mods_needing_action: usize,
    pub message: String,
}

/// What checking a server's declared mods against Steam found.
struct ModVerification {
    /// Install folders of the ready mods, in the server's declared order.
    /// Order is load-bearing — see `build_mod_string`.
    ready_paths: Vec<String>,
    /// `(name, state)` for every mod that would stop the launch.
    blocked: Vec<(String, ModState)>,
    /// Workshop mods considered. Excludes id-0 server-side entries.
    checked: usize,
}

/// Verify every declared mod against Steam. Blocking — must run on a
/// blocking task, not inline from the async command. Non-Workshop entries
/// (id 0, server-side mods) are skipped rather than blocking the launch.
fn verify_mods(
    steam: &tetra_steam::SteamHandle,
    mods: &[tetra_core::a2s::dayz::ServerMod],
) -> Result<ModVerification, String> {
    // One batched round trip rather than a dispatch per mod.
    let ids: Vec<u64> = mods
        .iter()
        .map(|m| m.workshop_id)
        .filter(|id| ModState::is_workshop_id(*id))
        .collect();
    let states = steam
        .mod_states(&ids)
        .map_err(|e| format!("Could not read Workshop state from Steam: {e}"))?;

    let mut out = ModVerification {
        ready_paths: Vec::with_capacity(ids.len()),
        blocked: Vec::new(),
        checked: 0,
    };

    for m in mods
        .iter()
        .filter(|m| ModState::is_workshop_id(m.workshop_id))
    {
        out.checked += 1;
        let state = states
            .iter()
            .find(|(id, _)| *id == m.workshop_id)
            .map(|(_, s)| *s)
            .unwrap_or(ModState::NotSubscribed);

        if !state.is_ready() {
            out.blocked.push((m.name.clone(), state));
            continue;
        }

        // "Installed" is Steam's claim, not a verified fact — the folder still has to exist.
        match steam.mod_folder(m.workshop_id) {
            Ok(Some(folder)) => out.ready_paths.push(folder.to_string_lossy().into_owned()),
            _ => out.blocked.push((m.name.clone(), ModState::NotInstalled)),
        }
    }

    Ok(out)
}

/// How long the launcher stays put after a join before hiding or quitting —
/// DayZ takes several seconds to put a window up, so the confirmation gets read first.
const ON_JOIN_GRACE: std::time::Duration = std::time::Duration::from_secs(4);

/// Hide or quit the launcher after a join. Spawned rather than awaited so
/// `launch_game` returns immediately with its `LaunchOutcome`.
fn apply_on_join(app: &AppHandle, on_join: OnJoin) {
    if on_join == OnJoin::Stay {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ON_JOIN_GRACE).await;
        match on_join {
            OnJoin::Tray => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            // Goes through the same `exit` every other quit path uses, so
            // `RunEvent::Exit` still shuts Steam down cleanly.
            OnJoin::Close => app.exit(0),
            OnJoin::Stay => {}
        }
    });
}

// `app`/`state` are Tauri injections; the rest are the actual launch inputs — not worth a struct.
/// Run the pre-launch mod gate and spawn DayZ. Fails closed: if the server's rules are unreadable, DayZ does not launch.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn launch_game(
    app: AppHandle,
    state: State<'_, AppState>,
    addr: String,
    game_port: u16,
    password: Option<String>,
    profile_name: Option<String>,
    dayz_path_override: Option<String>,
    launch_params: Option<Vec<String>>,
    main_menu: Option<bool>,
) -> Result<LaunchOutcome, String> {
    let main_menu = main_menu.unwrap_or(false);
    // The frontend sends addr as "IP:query_port" — extract just the IP
    let ip = addr
        .split(':')
        .next()
        .ok_or_else(|| format!("Invalid address: {addr}"))?;
    // Parsed purely to reject a malformed IP before anything is spawned; the
    // game connection is built from `ip` and `game_port` separately below.
    let _: SocketAddr = format!("{ip}:{game_port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;
    let query_addr: SocketAddr = addr
        .parse()
        .map_err(|e| format!("Invalid query address: {e}"))?;

    // Look the row up now so "Checking mods" can appear immediately, and
    // stash it for reuse once the launch succeeds. Best-effort throughout.
    let mut discord_row: Option<tetra_registry::ServerListRow> = None;
    if !main_menu {
        if let SocketAddr::V4(v4) = query_addr {
            let key = tetra_registry::rows::ServerKey {
                ip: *v4.ip(),
                query_port: v4.port(),
            };
            if let Ok(reader) = crate::commands::server::reader(&state) {
                let row = tokio::task::spawn_blocking(move || reader.get(key))
                    .await
                    .ok()
                    .and_then(|r| r.ok())
                    .flatten();
                if let Some(row) = row {
                    if let Ok(mut slot) = state.discord_now_playing.lock() {
                        *slot = Some(tetra_discord::DiscordSession::Verifying {
                            server_name: row.name.clone(),
                        });
                    }
                    discord_row = Some(row);
                }
            }
        }
    }

    // Wrapped in one block so there's exactly one place that clears the
    // "Checking mods" presence on failure, not one at every early return.
    let launch_prep: Result<(std::path::PathBuf, Vec<String>, usize, usize), String> = async {
        // Get the prober for live A2S_RULES re-query
        let prober = {
            let guard = state.prober.lock().map_err(|e| e.to_string())?;
            guard.as_ref().ok_or("Prober not initialized")?.clone()
        };

        // Discover DayZ install path — use manual override if provided
        let dayz_dir = if let Some(ref manual_path) = dayz_path_override {
            let path = std::path::PathBuf::from(manual_path);
            if !path.exists() {
                return Err(format!("DayZ path does not exist: {manual_path}"));
            }
            path
        } else {
            let paths = tetra_launch::registry_discovery::find_steam_paths()
                .ok_or_else(|| "Could not find Steam/DayZ installation. Check registry or set path manually in Settings.".to_string())?;
            paths.dayz_install.clone()
        };

        let dayz_exe = find_dayz_exe(&dayz_dir).ok_or_else(|| {
            format!(
                "DayZ executable not found at {}. Try verifying game files in Steam.",
                dayz_dir.display()
            )
        })?;

        // Get the Steam handle for Workshop operations
        let steam = {
            let guard = state.steam.lock().map_err(|e| e.to_string())?;
            Arc::clone(guard.as_ref().ok_or("Steam not initialized")?)
        };

        // Unqueued: one query on a click, must not wait behind a refresh's thousands.
        let rules_payload = prober.rules_unqueued(query_addr).await.map_err(|e| {
            if stalled_mid_response(&e) {
                format!(
                    "{addr}:{game_port} started answering but stopped responding \
                     part-way through its mod list. Try again in a moment."
                )
            } else {
                format!(
                    "Could not query server rules at {addr}:{game_port}. \
                     The server may be offline or behind a firewall."
                )
            }
        })?;

        let mods = rules_payload.mods;
        let verification = tokio::task::spawn_blocking(move || verify_mods(&steam, &mods))
            .await
            .map_err(|e| format!("Task join error: {e}"))??;

        if !verification.blocked.is_empty() {
            return Err(describe_blockers(&verification.blocked));
        }

        let mod_arg = build_mod_string(&verification.ready_paths);

        // The user's own launchParams go ahead of -mod=, which build_launch_args keeps last.
        let extra_params = launch_params.unwrap_or_default();
        let args = build_launch_args(
            main_menu,
            ip,
            game_port,
            password.as_deref(),
            &mod_arg,
            &extra_params,
            profile_name.as_deref(),
        );

        Ok((dayz_exe, args, verification.ready_paths.len(), verification.checked))
    }
    .await;

    let (dayz_exe, args, mods_ready, mods_checked) = match launch_prep {
        Ok(v) => v,
        Err(e) => {
            crate::discord::clear_launch_presence(&app);
            return Err(e);
        }
    };

    if let Err(e) = spawn_dayz(&dayz_exe, &args) {
        crate::discord::clear_launch_presence(&app);
        return Err(format!("Failed to launch DayZ: {e}"));
    }

    // Only after the process actually started, so a failed gate never shows
    // up in RECENT. Writer scoped in its own block: the guard is `!Send`
    // and can't be held across the `.await` below.
    if !main_menu {
        let played_writer = {
            let guard = state.registry.lock().map_err(|e| e.to_string())?;
            guard.as_ref().map(|r| r.writer())
        };
        if let (Some(writer), SocketAddr::V4(v4)) = (played_writer, query_addr) {
            let key = tetra_registry::rows::ServerKey {
                ip: *v4.ip(),
                query_port: v4.port(),
            };
            // Best-effort — a failed RECENT write must not fail an already-succeeded
            // launch — but a 0-row result is logged since it shouldn't be possible.
            match writer.mark_played(key).await {
                Ok(0) => crate::log::log_line(
                    &app,
                    "launch",
                    &format!("mark_played: no row for {key:?} in the registry"),
                ),
                Ok(_) => {}
                Err(e) => crate::log::log_line(&app, "launch", &format!("mark_played failed: {e}")),
            }
        }

        // Promote the Verifying presence set above to Live, reusing the row already fetched.
        if let Some(row) = discord_row {
            let started_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let info = tetra_discord::PresenceInfo {
                server_name: row.name,
                map: Some(row.map_display),
                players: row.players,
                max_players: row.max_players,
                started_at,
                in_game_time: row.in_game_time,
                ip: row.key.ip.to_string(),
                query_port: row.key.query_port,
            };
            if let Ok(mut slot) = state.discord_now_playing.lock() {
                *slot = Some(tetra_discord::DiscordSession::Live(info));
            }
        }
    }

    // Deliberately after mark_played: closing the launcher must not cost the RECENT entry.
    let on_join = state.on_join.lock().map(|g| *g).unwrap_or_default();
    apply_on_join(&app, on_join);

    Ok(LaunchOutcome {
        status: "launched".into(),
        mods_checked,
        mods_ready,
        // Reaching here means nothing was blocked — an early return covers the
        // other case.
        mods_needing_action: 0,
        message: if main_menu {
            format!("Launched DayZ to the main menu with {mods_ready} mods")
        } else {
            format!("Launched DayZ with {mods_ready} mods")
        },
    })
}

/// What a pre-launch verification found.
#[derive(serde::Serialize)]
pub struct VerifyOutcome {
    /// The server's mod list as it declares it *right now*, in declared order.
    /// The details panel replaces its own list with this.
    pub mods: Vec<crate::commands::server::ModEntry>,
    /// Workshop ids a fresh copy was queued for, stringified for JS.
    pub refreshed: Vec<String>,
    /// Whether Steam was reachable enough to check freshness at all. `false`
    /// means `refreshed` is empty because nothing was asked, not because
    /// everything was current.
    pub checked_workshop: bool,
}

/// Re-read a server's mod list and bring the local copies up to date,
/// without launching anything — the "Verify" half of VERIFY & JOIN. Not
/// folded into `launch_game`: verifying is slow, and the frontend needs to
/// show progress and stay cancellable across it. `launch_game` keeps its
/// own gate regardless. See .ai-notes/src-tauri/src/commands/launch.rs.md.
#[tauri::command]
pub async fn verify_server_mods(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<VerifyOutcome, String> {
    let key = crate::commands::server::server_key(&addr, query_port)?;
    let query_addr = SocketAddr::from((key.ip, key.query_port));

    let prober = {
        let guard = state.prober.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Prober not initialized")?.clone()
    };

    // Unqueued, same reason as launch_game: one query on a click.
    let rules = prober.rules_unqueued(query_addr).await.map_err(|e| {
        if stalled_mid_response(&e) {
            format!(
                "{query_addr} started answering but stopped responding \
                 part-way through its mod list. Try again in a moment."
            )
        } else {
            format!(
                "Could not read the mod list from {query_addr}. \
                 The server may be offline or behind a firewall."
            )
        }
    })?;
    let declared = rules.mods;

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|r| r.writer())
    };
    if let Some(writer) = writer {
        let _ = writer.upsert_server_mods(key, declared.clone()).await;
    }

    let ids: Vec<u64> = declared
        .iter()
        .map(|m| m.workshop_id)
        .filter(|id| ModState::is_workshop_id(*id))
        .collect();

    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(Arc::clone)
    };

    // Steam being absent is not a failure — the mod list was still refreshed.
    let (refreshed, checked_workshop) = match steam {
        None => (Vec::new(), false),
        Some(steam) => {
            let queued = tokio::task::spawn_blocking(move || steam.refresh_stale(&ids))
                .await
                .map_err(|e| format!("Task join error: {e}"))?;
            match queued {
                Ok(ids) => (ids, true),
                Err(e) => {
                    eprintln!("[verify] Workshop freshness check failed: {e}");
                    (Vec::new(), false)
                }
            }
        }
    };

    Ok(VerifyOutcome {
        mods: declared
            .into_iter()
            .map(|m| crate::commands::server::ModEntry {
                workshop_id: m.workshop_id.to_string(),
                name: m.name,
            })
            .collect(),
        refreshed: refreshed.into_iter().map(|id| id.to_string()).collect(),
        checked_workshop,
    })
}

/// Register the `dzsa://` protocol handler in the OS. Skips debug builds unless `TETRA_FORCE_PROTOCOL_REGISTER=1` is set.
#[tauri::command]
pub fn register_protocol_handler() -> Result<(), String> {
    if cfg!(debug_assertions) && std::env::var_os("TETRA_FORCE_PROTOCOL_REGISTER").is_none() {
        eprintln!("[protocol] Debug build: dzsa:// registration left untouched.");
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if tetra_launch::protocol::dzsa_registered_to(&exe) {
        return Ok(());
    }
    register_dzsa_protocol(&exe).map_err(|e| e.to_string())
}

/// Start the Steam client, for the "Start Steam" button on the startup
/// prompt. Returns immediately; the prompt retries the connection itself.
#[tauri::command]
pub fn open_steam() -> Result<(), String> {
    let exe = tetra_launch::registry_discovery::find_steam_exe().ok_or_else(|| {
        "Could not find steam.exe in the registry. Start Steam manually, then retry.".to_string()
    })?;
    tetra_launch::spawn::spawn_steam(&exe).map_err(|e| format!("Could not start Steam: {e}"))
}

/// Open a Workshop item's page in the Steam client, falling back to the OS opener if Steam can't be found.
#[tauri::command]
pub fn open_workshop_in_steam(workshop_id: String) -> Result<(), String> {
    let workshop_id: u64 = workshop_id
        .parse()
        .map_err(|_| format!("Not a valid Workshop id: {workshop_id}"))?;
    let url = format!("steam://url/CommunityFilePage/{workshop_id}");

    if let Some(exe) = tetra_launch::registry_discovery::find_steam_exe() {
        return tetra_launch::spawn::spawn_steam_with_url(&exe, &url)
            .map_err(|e| format!("Could not open Steam: {e}"));
    }

    eprintln!("[steam] No Steam executable found; falling back to the OS opener");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open {url}: {e}"))
}

/// Discover Steam and DayZ paths from the Windows registry.
#[tauri::command]
pub fn discover_steam_paths() -> Result<Option<SteamPaths>, String> {
    let paths = tetra_launch::registry_discovery::find_steam_paths();
    Ok(paths.map(|p| SteamPaths {
        steam_install: p.steam_install.to_string_lossy().into_owned(),
        dayz_install: p.dayz_install.to_string_lossy().into_owned(),
        workshop_dir: p.workshop_dir.to_string_lossy().into_owned(),
    }))
}

/// Whether a DayZ session is running right now. Called once on mount for an
/// immediate answer; day-to-day updates arrive via the `dayz-running` event
/// (see [`start_dayz_watcher`]) instead of polling this. Enumerates every
/// process on the machine, so it runs on a blocking task.
#[tauri::command]
pub async fn dayz_running() -> Result<bool, String> {
    tokio::task::spawn_blocking(tetra_launch::running::dayz_is_running)
        .await
        .map_err(|e| format!("Task join error: {e}"))
}

/// How often [`start_dayz_watcher`] checks whether a DayZ process exists.
const DAYZ_WATCH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(4);

/// Push `dayz-running` state changes to the frontend instead of leaving it
/// to poll. Reuses one persistent `ProcessWatch` across ticks rather than
/// rebuilding it. Emitted only on change.
pub fn start_dayz_watcher(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut watch = tetra_launch::running::ProcessWatch::new();
        let mut last: Option<bool> = None;
        let mut interval = tokio::time::interval(DAYZ_WATCH_INTERVAL);
        loop {
            interval.tick().await;
            let result = tokio::task::spawn_blocking(move || {
                let running = watch.dayz_is_running();
                (watch, running)
            })
            .await;
            let running = match result {
                Ok((w, running)) => {
                    watch = w;
                    running
                }
                // Task panicked, ProcessWatch is gone with it — rebuild and skip this tick.
                Err(_) => {
                    watch = tetra_launch::running::ProcessWatch::new();
                    continue;
                }
            };
            if last == Some(running) {
                continue;
            }
            last = Some(running);
            let _ = app.emit("dayz-running", running);
        }
    });
}
