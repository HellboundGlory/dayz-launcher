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

/// Added to the command line registered with the OS startup entry, so
/// `start_minimised` can apply only to an OS-triggered launch.
const AUTOSTART_FLAG: &str = "--autostart";

/// Whether this process was started by the OS startup entry rather than by hand.
fn launched_by_os() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_FLAG)
}

/// Tell Steam the session ended. Called from `RunEvent::Exit`, the one event
/// that fires however the app is quitting. `try_unwrap` only succeeds with
/// no in-flight command holding a clone — if one is, exit proceeds anyway.
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
/// `unminimize` must go first — otherwise `show` can emit a `Resized` that
/// the minimise-to-tray handler reads as "still minimised" and hides right back.
fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // First, ahead of every other plugin: a duplicate launch must die
        // before it opens the registry or starts a second Steam session.
        // Runs in the original process with the duplicate's argv, so a
        // `dzsa://` link on that command line isn't lost.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            protocol::handle_argv(app, &argv);
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        // Explicit quit, not "last window closed": Steamworks' overlay hook
        // creates untracked native windows that can keep that count from
        // ever reaching zero. Scoped to `main` (see .ai-notes/src-tauri/src/lib.rs.md).
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
                        // prevent_close stops tao destroying the window out from under us.
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
                    // Steam shutdown happens in `shutdown_steam`, off `RunEvent::Exit`.
                    app.exit(0);
                }
                // No `Minimized` window event exists (tao reports it as a resize),
                // so the state is queried instead of inferred from size.
                tauri::WindowEvent::Resized(_) => {
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

            // Resolve the registry to the data root, never a bare relative
            // "tetra.db" (see `paths` module for why).
            let data_root = paths::data_root(app.handle());
            let _ = std::fs::create_dir_all(&data_root);

            // Must run before anything opens a file in data_root, or the
            // migration would move a database out from under a live connection.
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

            // Falls back to in-memory on failure rather than bricking the app;
            // `registry_degraded` lets the frontend warn about the data loss.
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

            // Tells the frontend when it's safe to retry queries that raced
            // ahead of setup and got "Registry not initialized".
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

            // The single process-wide prober, so the concurrency bound applies
            // app-wide. Sized from settings, read once at startup.
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
                max_in_flight: saved
                    .max_concurrent_queries
                    .clamp(1, tetra_net::MAX_IN_FLIGHT_CEILING),
                timeout: std::time::Duration::from_millis(
                    saved.query_timeout_ms.clamp(100, 10_000),
                ),
                ..ProbeConfig::default()
            };
            *state.prober.lock().unwrap() = Some(tetra_net::Prober::new(probe_config));

            let window = app
                .get_webview_window("main")
                .ok_or("no `main` window in the Tauri config")?;

            // Cosmetic — a build that can't composite acrylic shouldn't refuse to start.
            #[cfg(target_os = "windows")]
            if let Err(e) = apply_acrylic(&window, Some((18, 18, 18, 85))) {
                eprintln!("[setup] Acrylic unavailable, using an opaque window: {e}");
            }

            // Restore geometry before the window is shown, and seed the cache
            // here so a maximised window survives (see `window_state`).
            if let Some(geometry) = saved.window {
                if let Ok(mut guard) = state.window_state.lock() {
                    *guard = Some(geometry);
                }
                window_state::restore(&window.as_ref().window(), geometry);
            }

            // Main window visibility is decided by the frontend — it shows
            // `main` and closes the splash once startup is ready (see App.tsx).
            commands::settings::apply_autostart(app.handle(), saved.start_with_windows);

            // Before the window is revealed, never after — avoids a reflow flash.
            commands::settings::apply_ui_scale(app.handle(), saved.scale());
            commands::settings::fit_window_to_minimum(app.handle(), saved.scale());

            // After apply_ui_scale, whose set_min_size would otherwise undo it.
            if saved.window.is_some_and(|geometry| geometry.maximized) {
                window_state::restore_maximized(&window.as_ref().window());
            }

            // Read from the live window, not `saved.window`: tao emits no
            // Moved/Resized for a window merely created and shown, so this is
            // what seeds the cache if nobody ever drags it.
            window_state::remember(&window.as_ref().window());

            // A `dzsa://` link on this process's own argv — single-instance
            // wasn't around to forward it.
            let argv: Vec<String> = std::env::args().collect();
            protocol::handle_argv(app.handle(), &argv);

            if let Err(e) = commands::launch::register_protocol_handler() {
                eprintln!("[setup] Could not register the dzsa:// protocol handler: {e}");
            }

            // No splash for a silent autostart — it goes straight to the tray.
            let start_hidden = launched_by_os() && saved.start_minimised;
            if !start_hidden {
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.show();
                }
            }

            // Built unconditionally: close_to_tray is changeable at runtime,
            // so the tray must already exist the first time it's needed.
            let show = MenuItem::with_id(app, "show", "Show Tetra Launcher", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu =
                Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().ok_or("no window icon")?)
                .tooltip("Tetra Launcher")
                .menu(&menu)
                // Left click reveals the window; right-click opens the menu.
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
        // The single shutdown choke point — `RunEvent::Exit` fires however the
        // process is ending. `restart_requested` bridges an updater restart's
        // two events; Linux-only, see .ai-notes/src-tauri/src/lib.rs.md.
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
                    // Geometry is written from the cache, not read off the
                    // window — by this point it may be hidden or already gone.
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
                        // Before shutting Steam down, so the actor join isn't
                        // left waiting on an in-flight server-list request.
                        state.shutting_down.store(true, Ordering::Relaxed);
                    }

                    commands::settings::persist_window_state(app);
                    shutdown_steam(app);
                    // Best-effort, non-blocking — Discord clears activity on its
                    // own once the IPC pipe closes anyway.
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

                    // Linux: glibc's exit() trips heap corruption unloading
                    // NVIDIA/WebKit modules, so use _exit instead (see
                    // .ai-notes/src-tauri/src/lib.rs.md) — restart is replicated manually below.
                    #[cfg(target_os = "linux")]
                    {
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
