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
/// stopped, rather than never responding at all — see
/// `tetra_net::NetError::ExchangeTimedOut`. Both `launch_game` and
/// `verify_server_mods` issue exactly one of these on a click
/// (`Prober::rules_unqueued`) and both owe the player a truer explanation
/// than "may be offline or behind a firewall" when the server was plainly
/// reachable and simply never finished.
fn stalled_mid_response(e: &tetra_net::NetError) -> bool {
    matches!(e, tetra_net::NetError::ExchangeTimedOut { .. })
}

/// Turn the blocked mods into one message that says what to actually do.
///
/// Grouped by cause: "not installed" and "needs updating" call for different
/// actions, and the old message called every failure "not installed" and told
/// the user to subscribe — useless advice for a mod they were already
/// subscribed to that merely had a pending update.
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

/// Verify every declared mod against Steam.
///
/// **Blocking.** Each `SteamHandle` call dispatches to the Steam actor thread
/// and waits on a channel, so this must run on a blocking task — it used to be
/// called inline from the `async` command, parking a Tokio worker for as long as
/// Steam took to answer for a 93-mod server.
///
/// Non-Workshop entries (id 0 — server-side or locally-installed mods) are
/// skipped: there is nothing to verify, nothing to download, and no install
/// folder to put on the `-mod=` line. Blocking the launch on them would make
/// every server that declares one permanently unjoinable over something the user
/// cannot act on.
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

        // Installed per Steam, but the folder still has to exist — spec §5.4 is
        // explicit that "installed" is Steam's claim, not a verified fact.
        match steam.mod_folder(m.workshop_id) {
            Ok(Some(folder)) => out.ready_paths.push(folder.to_string_lossy().into_owned()),
            _ => out.blocked.push((m.name.clone(), ModState::NotInstalled)),
        }
    }

    Ok(out)
}

/// Run the pre-launch mod gate and spawn DayZ.
///
/// Flow (spec §5):
/// 1. Fetches live A2S_RULES from the server (ignores cache)
/// 2. Checks each workshop mod's install state via Steam UGC
/// 3. Constructs -mod= line in server-declared order
/// 4. Spawns DayZ via CreateProcess (never through shell)
///
/// Fails closed: if the server's rules are unreadable, DayZ does not launch.
/// How long the launcher stays put after a join before hiding or quitting.
///
/// DayZ takes several seconds to put a window up. Vanishing the instant the
/// process spawns leaves the user staring at their desktop wondering whether
/// the click registered, so the confirmation gets to be read first.
const ON_JOIN_GRACE: std::time::Duration = std::time::Duration::from_secs(4);

/// Hide or quit the launcher after a join, per `AppSettings::on_join`.
///
/// Spawned rather than awaited so `launch_game` returns immediately and the
/// frontend still receives its `LaunchOutcome` — a command that exited the
/// process before replying would look like a failed launch.
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

// Two of the eight are Tauri injections (`app`, `state`) rather than a caller's
// choice, and the remaining six are the launch's actual inputs. Grouping them
// into a struct would change the shape the frontend invokes with for no gain.
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

    // Discord Rich Presence: look the row up now, as early as possible, so
    // "Checking mods" can appear the instant the button is pressed rather
    // than after the (potentially slow) verification below — and stash it
    // for reuse once the launch actually succeeds, avoiding a second lookup
    // of the same row further down. Never for a main-menu load — same
    // scoping as the RECENT-list write later in this function. Best-effort
    // throughout: a lookup failure here must never affect the launch that's
    // about to happen, it just means presence has nothing to show.
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

    // Everything from here to a successful `spawn_dayz` can fail in several
    // ways. Wrapped in one block so there is exactly one place — right
    // below — that has to remember to clear the "Checking mods" presence on
    // failure, rather than one at every early return.
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

        // 1. Fetch live A2S_RULES from the server. Unqueued: this is one query on a
        //    click, and it must not wait behind a refresh's thousands.
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

        // 2. Check each mod's install state, off the async runtime — every Steam
        //    call in `verify_mods` blocks on the actor thread.
        let mods = rules_payload.mods;
        let verification = tokio::task::spawn_blocking(move || verify_mods(&steam, &mods))
            .await
            .map_err(|e| format!("Task join error: {e}"))??;

        if !verification.blocked.is_empty() {
            return Err(describe_blockers(&verification.blocked));
        }

        // 3. Build -mod= in server-declared order
        let mod_arg = build_mod_string(&verification.ready_paths);

        // 4. The user's own `launchParams` go in ahead of `-mod=`, which
        //    `build_launch_args` keeps last. These were previously dropped: the
        //    call site passed a hardcoded `&[]`, so a setting that persisted fine
        //    and had a slot waiting for it never reached the command line.
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

    // Record the visit only after the process actually started, so a failed
    // gate never shows up in the RECENT list. A main-menu load is not a join,
    // so it gets no RECENT entry.
    //
    // The writer is lifted out in its own scope: `state.registry` is a
    // `std::sync::Mutex`, whose guard is not `Send`, and holding one across the
    // `.await` below makes the whole command future non-`Send`.
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
            // Best-effort, same as every other path here — a RECENT entry
            // that failed to write must not fail a launch that already
            // succeeded. But unlike the old bare `let _ =`, a miss is now
            // distinguishable from success and worth a log line: an affected
            // count of 0 means DayZ was just launched against a server this
            // registry has no row for at all, which should not be able to
            // happen (the row is what the JOIN button was clicked from) and
            // is worth knowing about if it ever does.
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

        // Discord Rich Presence: promote the `Verifying` state set at the top
        // of this function to `Live`, reusing the row already fetched there
        // rather than reading it a second time. `discord_row` is `None` if
        // that first lookup failed — best-effort throughout, so nothing here
        // affects the launch that already succeeded either way.
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

    // Get out of the way once DayZ is starting, for a real join *and* a
    // main-menu load — either way the player is moving into the game and the
    // launcher has done its job. Deliberately after `mark_played`: closing the
    // launcher must not cost the RECENT entry. (Only the join applies that;
    // the load just skips it above.)
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

/// Re-read a server's mod list and bring the local copies up to date, without
/// launching anything.
///
/// This is the "Verify" half of VERIFY & JOIN, and it exists because two
/// separate things could be out of date at the point someone clicks join:
///
/// 1. **The mod list.** The details panel renders whatever the registry last
///    recorded. A server that added a mod since the last refresh would be
///    launched against the old list.
/// 2. **The mods themselves.** `item_state` reports what the Steam *client*
///    last noticed about the Workshop, and it lags. A mod that has been updated
///    but that Steam has not looked at yet reports as installed and current;
///    the gate passes it, DayZ starts, and the server rejects the connection
///    over an outdated mod list. See `SteamHandle::refresh_stale`.
///
/// Deliberately *not* folded into `launch_game`. Verifying is slow — a live
/// A2S_RULES round trip plus a Workshop query — and the frontend needs to show
/// progress and stay cancellable across it. `launch_game` keeps its own gate
/// and remains the authority on whether DayZ actually starts; this only means
/// the gate is far less likely to have to say no.
#[tauri::command]
pub async fn verify_server_mods(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<VerifyOutcome, String> {
    // `addr` already carries a port — the frontend sends "IP:query_port" — so
    // appending `query_port` produced "1.2.3.4:2303:2303" and every click on
    // VERIFY & JOIN failed with "invalid socket address syntax". `server_key`
    // is the one place that convention is decoded; going through it means this
    // cannot drift again, and it yields the registry key for free.
    let key = crate::commands::server::server_key(&addr, query_port)?;
    let query_addr = SocketAddr::from((key.ip, key.query_port));

    let prober = {
        let guard = state.prober.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Prober not initialized")?.clone()
    };

    // Unqueued for the same reason `launch_game` is: this is one query on a
    // click and must not wait behind a refresh's thousands.
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

    // Write the fresh list back, so the MODS column and a later `get_server_mods`
    // agree with what the panel is about to show.
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

    // Steam being absent is not a failure of verification — the mod list was
    // still refreshed, which is half the job. The gate will refuse the launch
    // later if that matters.
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

/// Register the `dzsa://` protocol handler in the OS.
///
/// Skips the write when the OS's current registration already names this
/// executable — see `tetra_launch::protocol::dzsa_registered_to`. Previously
/// this ran unconditionally on every launch, rewriting the same registry
/// values (Windows) or desktop file (Linux) whether or not anything had
/// actually changed (M11, 2026-08-29 audit).
///
/// **Debug builds never touch the OS**, same reasoning as
/// `commands::settings::apply_autostart`: the registration is a single
/// global mapping recording an absolute path to *this* executable, and a
/// debug build's path (`target/debug/…`) is not stable across rebuilds —
/// worse, on a machine that also has an installed release copy, a debug run
/// would silently repoint every `dzsa://` link on the machine at a build
/// that may not even exist by the time someone clicks one. Set
/// `TETRA_FORCE_PROTOCOL_REGISTER=1` to exercise this path from a debug
/// build deliberately.
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

/// Start the Steam client.
///
/// Backs the "Start Steam" button on the startup prompt, so that a user who
/// opened the launcher first does not have to go and find Steam themselves.
/// Returns immediately — Steam takes a while to sign in, and the prompt keeps
/// retrying the connection in the background until it does.
#[tauri::command]
pub fn open_steam() -> Result<(), String> {
    let exe = tetra_launch::registry_discovery::find_steam_exe().ok_or_else(|| {
        "Could not find steam.exe in the registry. Start Steam manually, then retry.".to_string()
    })?;
    tetra_launch::spawn::spawn_steam(&exe).map_err(|e| format!("Could not start Steam: {e}"))
}

/// Open a Workshop item's page in the Steam client, not the browser.
///
/// The launcher resolves the Steam executable itself and hands it the
/// `steam://url/CommunityFilePage/<id>` URL. A running Steam client is focused
/// and navigated (its second-instance forwards the URL); a non-running one
/// starts and opens the page. Only if Steam cannot be found at all does this
/// fall back to the OS opener, whose scheme handler may or may not be
/// registered.
///
/// `workshop_id` is parsed as `u64` before it ever reaches the URL (H4,
/// 2026-08-29 audit) — it arrives as a JS string over IPC, and previously
/// went straight into the `steam://` URL and then into an argv handed to
/// `explorer`/`xdg-open` unvalidated, so anything other than digits could
/// change what those processes were actually asked to do.
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

/// Whether a DayZ session is running right now.
///
/// Called once, on mount, by `watchDayz` for an immediate answer; day-to-day
/// updates instead arrive by listening for `dayz-running` (see
/// [`start_dayz_watcher`]) rather than polling this repeatedly. The launcher
/// does not wait on the process it spawns — see
/// `tetra_launch::spawn::spawn_dayz` — so this is the only way to know, and
/// it is also right for a session the launcher never started.
///
/// `async` + `spawn_blocking`: this enumerates every process on the machine
/// (`sysinfo`'s `CreateToolhelp32Snapshot` on Windows), which is too heavy to
/// run inline on Tauri's main thread the way a plain `fn` command would.
#[tauri::command]
pub async fn dayz_running() -> Result<bool, String> {
    tokio::task::spawn_blocking(tetra_launch::running::dayz_is_running)
        .await
        .map_err(|e| format!("Task join error: {e}"))
}

/// How often [`start_dayz_watcher`] checks whether a DayZ process exists.
const DAYZ_WATCH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(4);

/// Push `dayz-running` state changes to the frontend instead of leaving it to
/// poll `dayz_running` on its own timer.
///
/// Before this, the frontend polled `dayz_running` every 4s and — whenever a
/// launch was live — the Discord presence loop separately polled
/// `dayz_running_since` every 5s: two independent full process-table
/// enumerations running on their own clocks for the life of the session. One
/// shared, persistent `System` here (reused every tick via
/// `dayz_is_running_with` rather than rebuilt) replaces both: the frontend
/// listens for this event instead of invoking the command repeatedly.
/// Emitted only on change, mirroring `LaunchState.setDayzRunning`'s own
/// equality check on the frontend.
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
                // The task panicked — the `ProcessWatch` moved into it is
                // gone. Build a fresh one so the next iteration's `move`
                // closure still has something to capture, and skip this
                // tick's report rather than emit a possibly-wrong answer.
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
