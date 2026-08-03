use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Listener, Manager};
use tetra_net::ProbeConfig;
use tetra_registry::Registry;
use window_vibrancy::apply_acrylic;

mod commands;
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
        .on_window_event(|window, event| match event {
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
        })
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::server::get_server_list,
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
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::set_ui_scale,
            commands::settings::open_data_folder,
            commands::settings::data_folder_path,
            commands::update::is_installed_copy,
        ])
        .setup(|app| {
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

            // Visibility is decided in exactly one place, at the end of `setup`,
            // and never restored from disk. Reviving a saved "hidden" would mean
            // that quitting from the tray started the next session invisible —
            // the flag working as designed and still not what anyone wants.
            //
            // Start-minimised works by *withholding* this call rather than by
            // minimising afterwards. Minimising would mean painting the window
            // and then animating it away, which is the flash the hidden-window
            // dance exists to avoid. It only applies when the launcher was
            // started by Windows: someone who double-clicks the icon wants the
            // window, whatever the setting says.
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

            let start_hidden = launched_by_os() && saved.start_minimised;
            if start_hidden {
                let _ = window.hide();
            } else {
                let _ = window.show();
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

            app.listen("dzsa-protocol", protocol::handle_deep_link);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // The single shutdown choke point. `RunEvent::Exit` fires however the
        // process is ending, so neither the tray's Quit nor an updater restart
        // can skip telling Steam the session is over.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Both of these need the one event that fires however the
                // process is ending, so neither the tray's Quit nor an updater
                // restart can skip them. The geometry is written from the cache
                // rather than read off the window here — by this point the
                // window may be hidden or already gone.
                commands::settings::persist_window_state(app);
                shutdown_steam(app);
            }
        });
}
