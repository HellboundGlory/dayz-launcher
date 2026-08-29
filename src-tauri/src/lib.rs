use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tetra_net::ProbeConfig;
use tetra_registry::Registry;
#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;

mod atomic_write;
mod commands;
mod discord;
mod log;
mod paths;
mod protocol;
mod state;
mod window_state;

/// Added to the command line registered with the OS startup entry.
///
/// Its only job is to distinguish a launch Windows performed from one the user
/// performed, so `start_minimised` can apply to the first and never the second.
const AUTOSTART_FLAG: &str = "--autostart";

/// Whether this process was started by the OS startup entry rather than by hand.
fn launched_by_os() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_FLAG)
}

/// Tell Steam the session ended, rather than leaving it to notice the process
/// died.
///
/// **Every exit route must pass through here**, which is why it hangs off
/// `RunEvent::Exit` — the one event that fires however the app is quitting: the
/// window close button, the tray's Quit item, or the updater restarting us.
/// It used to live inline in the `CloseRequested` handler, which was the only
/// shutdown path in the app; the moment closing could mean "hide to tray"
/// instead of "quit", that handler stopped being a reliable place for it.
///
/// `try_unwrap` only succeeds with no in-flight command holding a clone. If one
/// is, the exit happens anyway — a missed Steam shutdown is untidy, a hung exit
/// is a bug.
fn shutdown_steam(app: &AppHandle) {
    if let Some(state) = app.try_state::<state::AppState>() {
        if let Ok(mut guard) = state.steam.lock() {
            if let Some(handle) = guard.take() {
                if let Ok(handle) = Arc::try_unwrap(handle) {
                    let _ = handle.shutdown();
                }
            }
        }
    }
}

/// Bring the main window back from the tray (or from minimised).
///
/// All three calls are needed: `unminimize` undoes the taskbar, `show` undoes
/// `hide`, and `set_focus` is what actually raises it above whatever the user is
/// looking at.
///
/// **`unminimize` goes first, and that ordering is load-bearing** now that
/// minimise-to-tray hides on any resize that leaves the window minimised.
/// Showing a still-minimised window can emit a `Resized` whose handler would
/// see `is_minimized() == true` and hide it straight back — the click on the
/// tray icon would do nothing. Clearing the minimised state first means no
/// event raised by this function can satisfy that condition.
fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // **First**, ahead of every other plugin. A duplicate launch has to die
        // before it opens the registry, rewrites settings.json or starts a
        // second Steam session against the same appid — all of which the
        // plugins below would have done by the time a later registration ran.
        //
        // The callback runs in the *original* process, with the duplicate's
        // command line. Two things have to happen there: show the window the
        // user was evidently trying to open, and take over the arguments the
        // dead process was carrying, since a `dzsa://` link arrives as argv and
        // would otherwise be silently discarded from this point on.
        //
        // Note the plugin keys on the bundle identifier, so a debug build and
        // an installed release build count as the same app and will refuse to
        // run alongside each other.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            protocol::handle_argv(app, &argv);
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // The registered startup command carries `--autostart`, which is the
        // only way to tell "Windows started me" from "the user double-clicked
        // me". Start-minimised must not apply to the second case, or enabling
        // it would leave no way to open the launcher by hand.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        // Steamworks' overlay hook creates native windows of its own, outside
        // tao's tracking — on at least some machines that stops the window
        // count from ever reaching zero, so the implicit "exit when the last
        // window closes" path never fires and the process (and its Steam
        // session) lingers after the window disappears. Forced explicitly
        // rather than relying on that heuristic.
        //
        // **Scoped to `main`.** This handler is registered app-wide and every
        // arm below was written when `main` was the only window there was. The
        // splash window broke all three of them: its `close()` — the frontend's
        // normal way of dismissing it — arrives here as `CloseRequested` and
        // falls straight through to `app.exit(0)`, killing the process at the
        // exact moment the launcher was about to be revealed. (With
        // close-to-tray on it is worse in a quieter way: `prevent_close` means
        // the splash never closes at all and lingers as a hidden always-on-top
        // window.) `Resized`/`Moved` would meanwhile record the splash's fixed
        // 860×484 and its position as the *launcher's* remembered geometry —
        // `window_state::remember` filters out the 0×0 of a minimise, not a
        // second window's perfectly plausible size.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let app = window.app_handle();
                    let to_tray = app
                        .try_state::<state::AppState>()
                        .map(|s| s.close_to_tray.load(Ordering::Relaxed))
                        .unwrap_or(false);

                    if to_tray {
                        // Hide, don't quit. `prevent_close` is what stops tao
                        // destroying the window out from under us — without it the
                        // window is gone and the tray's Show has nothing to show.
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
                    // Steam shutdown deliberately does not happen here — see
                    // `shutdown_steam`, hung off `RunEvent::Exit` so it also covers
                    // the tray's Quit and the updater's restart.
                    app.exit(0);
                }
                // Minimising to the tray. There is no `Minimized` window event to
                // hang this off — tao reports a minimise as a resize — so the state
                // is queried rather than inferred from the size, which is 0×0 for
                // several unrelated reasons.
                //
                // Hiding an already-minimised window is what takes it off the
                // taskbar; `reveal_main_window` undoes both halves, which is why it
                // calls `unminimize` as well as `show`.
                tauri::WindowEvent::Resized(_) => {
                    // Cheap enough to run on every event of a drag — it reads the
                    // window and takes a mutex, and never touches the disk. The
                    // one write happens at exit. `remember` is also what filters
                    // out the 0×0 a minimise reports.
                    window_state::remember(window);

                    let app = window.app_handle();
                    let to_tray = app
                        .try_state::<state::AppState>()
                        .map(|s| s.minimise_to_tray.load(Ordering::Relaxed))
                        .unwrap_or(false);
                    if to_tray && window.is_minimized().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Moved(_) => window_state::remember(window),
                _ => {}
            }
        })
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::server::get_server_list,
            commands::server::get_server,
            commands::server::get_server_mods,
            commands::server::toggle_favourite,
            commands::server::get_map_list,
            commands::server::get_server_counts,
            commands::server::registry_degraded,
            commands::server::discover_servers,
            commands::server::refresh_servers,
            commands::server::refresh_visible_servers,
            commands::steam::steam_init,
            commands::steam::steam_connection_state,
            commands::steam::steam_mod_states,
            commands::steam::steam_download_progress,
            commands::steam::steam_subscribe_mods,
            commands::steam::steam_unsubscribe_mods,
            commands::launch::launch_game,
            commands::launch::verify_server_mods,
            commands::launch::register_protocol_handler,
            commands::launch::discover_steam_paths,
            commands::launch::open_steam,
            commands::launch::dayz_running,
            commands::launch::open_workshop_in_steam,
            commands::log::log_client,
            commands::mods::get_subscribed_mods,
            commands::mods::verify_subscribed_mods,
            commands::mods::get_mod_usage,
            commands::mods::get_cared_servers,
            commands::mods::get_unique_mods_for,
            commands::mods::get_servers_needing,
            commands::mods::reinstall_subscribed_mod,
            commands::mods::open_mod_folder,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::set_ui_scale,
            commands::settings::open_data_folder,
            commands::settings::data_folder_path,
            commands::update::is_installed_copy,
        ])
        .setup(|app| {
            let setup_started = Instant::now();
            let state = app.state::<state::AppState>();

            // Resolve the registry to the data root, never to a bare relative
            // "tetra.db". A relative path is interpreted against the process
            // working directory, so the launcher silently used a different
            // database depending on how it was started — one under
            // target/debug when the exe was double-clicked, another in the repo
            // root under `tauri dev`. Favourites and discovered servers
            // appeared to vanish purely because of where the shortcut pointed.
            //
            // `paths::data_root` is the single answer for this process: the exe
            // directory for a copy carrying the portable marker, local app data
            // otherwise. See that module for why the choice is never inferred
            // from the exe's location.
            let data_root = paths::data_root(app.handle());
            let _ = std::fs::create_dir_all(&data_root);

            // Before anything opens a file in there. A migration that ran after
            // `Registry::open` would be moving a database out from under a live
            // connection, and `load_at_startup` below would read the settings
            // file from the new location before it had arrived.
            let migration = paths::migrate_from_legacy(app.handle(), &data_root);
            if !migration.is_empty() {
                eprintln!(
                    "[setup] Moved {:?} into {} (kept the newer copy of {:?})",
                    migration.moved,
                    data_root.display(),
                    migration.skipped
                );
            }

            let db_path = data_root.join("tetra.db");

            // A failure here is not fatal — the launcher still browses and
            // launches — but it is *silent* data loss: an in-memory registry
            // forgets every favourite and every RECENT entry the moment the
            // process exits. The fallback is kept so a locked or corrupt file
            // does not brick the app, and `registry_degraded` lets the frontend
            // say so instead of leaving the user to discover it by losing their
            // favourites.
            let registry = match Registry::open(&db_path) {
                Ok(registry) => {
                    eprintln!("[setup] Registry ready at {}", db_path.display());
                    registry
                }
                Err(e) => {
                    eprintln!(
                        "[setup] Could not open {}: {e}. Falling back to in-memory — \
                         favourites and recently-played will not persist.",
                        db_path.display()
                    );
                    *state.registry_degraded.lock().unwrap() = true;
                    Registry::open_in_memory().expect("Failed to open in-memory registry")
                }
            };
            *state.registry.lock().unwrap() = Some(registry);

            // Splash-70% fix (progress.md): the frontend fires its startup
            // queries the moment the window loads, which can race ahead of this
            // closure — every one of those calls fails instantly with "Registry
            // not initialized" and, until now, nothing ever told the frontend
            // when it was safe to try again. This is that signal. Logged (not
            // just eprintln'd) so a report from an affected machine shows
            // whether setup was actually slow or the frontend just didn't wait.
            let degraded = *state.registry_degraded.lock().unwrap();
            crate::log::log_line(
                app.handle(),
                "setup",
                &format!(
                    "registry ready in {}ms (degraded={degraded})",
                    setup_started.elapsed().as_millis()
                ),
            );
            let _ = app.handle().emit(
                "registry-ready",
                serde_json::json!({ "degraded": degraded }),
            );

            // The single process-wide prober. Every probing path shares this so
            // the concurrency bound applies to the whole app, not one code path.
            //
            // Sized from the user's settings, which until now were written to
            // disk and read by nobody — the prober was built from
            // `ProbeConfig::default()` regardless of what `settings.json` said.
            // Read once, at startup; see `settings::load_at_startup`.
            let saved = commands::settings::load_at_startup(app.handle());
            state
                .close_to_tray
                .store(saved.closes_to_tray(), Ordering::Relaxed);
            state
                .minimise_to_tray
                .store(saved.minimise_to_tray, Ordering::Relaxed);
            if let Ok(mut guard) = state.on_join.lock() {
                *guard = saved.on_join;
            }
            discord::start(app.handle(), saved.discord_presence_enabled());
            commands::launch::start_dayz_watcher(app.handle());
            let probe_config = ProbeConfig {
                // `.max(1)` alone would let a hand-edited 0 through as 1 and a
                // hand-edited 100000 through as itself.
                max_in_flight: saved
                    .max_concurrent_queries
                    .clamp(1, tetra_net::MAX_IN_FLIGHT_CEILING),
                // A sub-100ms timeout drops distant-but-alive servers; the upper
                // bound keeps one dead peer from holding a permit for a minute.
                timeout: std::time::Duration::from_millis(
                    saved.query_timeout_ms.clamp(100, 10_000),
                ),
                ..ProbeConfig::default()
            };
            *state.prober.lock().unwrap() = Some(tetra_net::Prober::new(probe_config));

            let window = app
                .get_webview_window("main")
                .ok_or("no `main` window in the Tauri config")?;

            // Cosmetic. A machine or OS build that will not composite acrylic is
            // not a reason to refuse to start — this used to `.expect()`, and a
            // window that renders opaque is plainly better than one that panics.
            #[cfg(target_os = "windows")]
            if let Err(e) = apply_acrylic(&window, Some((18, 18, 18, 85))) {
                eprintln!("[setup] Acrylic unavailable, using an opaque window: {e}");
            }

            // Put the window back where it was last left, before it is shown.
            // The window is created `"visible": false` precisely so this can
            // happen against a window nobody has seen yet — applying a size to
            // a visible window is a flash at the default size followed by a
            // jump. This used to be `tauri-plugin-window-state`, which restored
            // before `setup` ran; it was dropped because it insisted on writing
            // its own file outside the data root. See `crate::window_state`.
            //
            // Seeding the cache here, not only at the `remember` further down,
            // is what makes a maximised window survive: `capture` deliberately
            // leaves size and position alone while maximised, so it needs the
            // pre-maximise geometry already in hand or it would record the
            // screen's dimensions as the size to un-maximise to.
            //
            // Maximising itself is deferred — see `restore_maximized`.
            if let Some(geometry) = saved.window {
                if let Ok(mut guard) = state.window_state.lock() {
                    *guard = Some(geometry);
                }
                window_state::restore(&window.as_ref().window(), geometry);
            }

            // The main launcher window's visibility is decided by the frontend,
            // not here: it stays hidden at setup, the separate splash window
            // carries the load, and once startup is ready the frontend shows
            // `main` itself and closes the splash (see `App.tsx`). Revealing
            // `main` here would paint the empty launcher around/behind the
            // splash, which is exactly what the separate splash window exists
            // to avoid. It is never hidden by start-minimised either — a hidden
            // launcher needs no hiding.
            // Reconcile the OS entry with the setting — a no-op in debug builds,
            // see `apply_autostart`.
            commands::settings::apply_autostart(app.handle(), saved.start_with_windows);

            // Before the window is revealed, never after. Zooming a visible
            // window reflows the whole layout in front of the user, which is
            // the same class of flash the hidden-window dance above exists to
            // avoid.
            commands::settings::apply_ui_scale(app.handle(), saved.scale());
            // Startup only — see the function's own note on why this is not
            // part of `apply_ui_scale`.
            commands::settings::fit_window_to_minimum(app.handle(), saved.scale());

            // After `apply_ui_scale`, whose `set_min_size` would otherwise undo
            // it. See `window_state::restore`.
            if saved.window.is_some_and(|geometry| geometry.maximized) {
                window_state::restore_maximized(&window.as_ref().window());
            }

            // Seed the geometry cache from the window as it now stands, after
            // every startup adjustment above has been applied.
            //
            // **Not from `saved.window`, and not conditional on it.** tao emits
            // no `Moved` or `Resized` for a window that is merely created and
            // shown, so a session where nobody drags the window would leave the
            // cache empty and the exit write with nothing to save — the window
            // position would never be remembered until the first time it was
            // moved. Reading the live window instead also picks up whatever
            // `fit_window_to_minimum` just did.
            window_state::remember(&window.as_ref().window());

            // A `dzsa://` link on this process's own command line — the case
            // where the launcher was not already running, so single-instance
            // never fired.
            let argv: Vec<String> = std::env::args().collect();
            protocol::handle_argv(app.handle(), &argv);

            // Claim the `dzsa://` scheme so the OS hands links to this exe —
            // best-effort and logged-not-fatal, same as `apply_autostart`.
            // `register_protocol_handler` itself now no-ops on a debug build
            // (M11, 2026-08-29 audit) and skips the write when the OS
            // registration already names this exe.
            if let Err(e) = commands::launch::register_protocol_handler() {
                eprintln!("[setup] Could not register the dzsa:// protocol handler: {e}");
            }

            // Show the splash window unless this is a silent autostart. A
            // start-minimised launch goes straight to the tray and wants no
            // splash; a hand launch gets the floating 860×484 splash while the
            // (still hidden) launcher boots.
            let start_hidden = launched_by_os() && saved.start_minimised;
            if !start_hidden {
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.show();
                }
            }

            // The tray. Built unconditionally rather than only when
            // `close_to_tray` is on: the setting is changeable at runtime, and
            // a tray that has to be created mid-session is a tray that isn't
            // there the first time someone closes the window.
            let show = MenuItem::with_id(app, "show", "Show Tetra Launcher", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu =
                Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().ok_or("no window icon")?)
                .tooltip("Tetra Launcher")
                .menu(&menu)
                // Left click reveals the window; the menu is the right-click
                // gesture people expect on Windows. With this left on, a plain
                // left click would open the menu instead of restoring.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => reveal_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // The single shutdown choke point. `RunEvent::Exit` fires however the
        // process is ending, so neither the tray's Quit nor an updater restart
        // can skip telling Steam the session is over.
        //
        // `restart_requested` bridges the two events an updater restart fires:
        // `ExitRequested` carries `RESTART_EXIT_CODE` (see `tauri::AppHandle::
        // restart`) the moment it's asked for, but the actual work has to
        // happen on `Exit` below, once teardown is done. Linux-only — see the
        // hardening note further down for why only Linux needs to track this
        // at all; tracking (and never reading) it on Windows would just be an
        // unused-assignment warning waiting to happen.
        .run({
            #[cfg(target_os = "linux")]
            let mut restart_requested = false;
            move |app, event| {
                #[cfg(target_os = "linux")]
                if let tauri::RunEvent::ExitRequested { code, .. } = event {
                    if code == Some(tauri::RESTART_EXIT_CODE) {
                        restart_requested = true;
                    }
                }
                if let tauri::RunEvent::Exit = event {
                    // Both of these need the one event that fires however the
                    // process is ending, so neither the tray's Quit nor an updater
                    // restart can skip them. The geometry is written from the cache
                    // rather than read off the window here — by this point the
                    // window may be hidden or already gone.
                    //
                    // Exit diagnostics (the Linux exit-crash note in progress.md):
                    // always say what state we leave in, so a report can tell
                    // whether Steam was still streaming when the process ended.
                    if let Some(state) = app.try_state::<state::AppState>() {
                        crate::log::log_line(
                            app,
                            "exit",
                            &format!(
                                "exit requested (discovery_running={}, steam_ready={})",
                                state.discovery_running.load(Ordering::Relaxed),
                                state.steam_ready.lock().map(|g| *g).unwrap_or(false),
                            ),
                        );
                        // Tell `discover_servers` to stop pulling chunks BEFORE we
                        // shut Steam down, so the actor join isn't left waiting on
                        // an in-flight server-list request.
                        state.shutting_down.store(true, Ordering::Relaxed);
                    }

                    commands::settings::persist_window_state(app);
                    shutdown_steam(app);
                    // Best-effort and non-blocking (a channel send, nothing more) —
                    // unlike `shutdown_steam` this never joins the thread. Discord
                    // clears the activity on its own once the IPC pipe closes, so
                    // skipping this on a failure changes nothing but timing.
                    if let Some(state) = app.try_state::<state::AppState>() {
                        if let Ok(guard) = state.discord.lock() {
                            if let Some(handle) = guard.as_ref() {
                                handle.clear();
                            }
                        }
                    }

                    crate::log::log_line(
                        app,
                        "exit",
                        "state persisted and Steam shut down; terminating",
                    );

                    // Linux exit-crash hardening (see progress.md / the coredump):
                    // glibc's `exit()` unloads the loaded libraries through its
                    // atexit pass, and on this system that pass tripped heap
                    // corruption in `free()` while `dlclose`'ing the NVIDIA/WebKit
                    // modules. All our real cleanup is done explicitly above, so
                    // terminate with `_exit` and skip that pass entirely. Windows
                    // never takes this path — its teardown is the proven, existing
                    // one.
                    #[cfg(target_os = "linux")]
                    {
                        // `_exit` below never returns, so Tauri's own post-callback
                        // restart check never runs either — `App::run`'s event loop
                        // (see `tauri::App::make_run_event_loop_callback`) only calls
                        // `tauri::process::restart` *after* this closure returns,
                        // which on Linux it now never does. That silently ate every
                        // updater restart the moment this hardening shipped — the
                        // update installed, the app just closed instead of coming
                        // back. Replicate the useful half of `restart` ourselves —
                        // resolve and spawn the next copy — before terminating,
                        // since its other half is `std::process::exit(0)`: the exact
                        // glibc teardown this hardening exists to avoid.
                        if restart_requested {
                            match tauri::process::current_binary(&app.env()) {
                                Ok(path) => match std::process::Command::new(&path)
                                    .args(app.env().args_os.iter().skip(1))
                                    .spawn()
                                {
                                    Ok(_) => crate::log::log_line(
                                        app,
                                        "exit",
                                        &format!("restart: relaunched {}", path.display()),
                                    ),
                                    Err(e) => crate::log::log_line(
                                        app,
                                        "exit",
                                        &format!(
                                            "restart: failed to relaunch {}: {e}",
                                            path.display()
                                        ),
                                    ),
                                },
                                Err(e) => crate::log::log_line(
                                    app,
                                    "exit",
                                    &format!(
                                        "restart: could not resolve the binary to relaunch: {e}"
                                    ),
                                ),
                            }
                        }

                        unsafe {
                            libc::_exit(0);
                        }
                    }
                }
            }
        });
}
