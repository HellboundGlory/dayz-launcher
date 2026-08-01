use std::sync::Arc;
use tauri::{Listener, Manager};
use tetra_net::ProbeConfig;
use tetra_registry::Registry;
use window_vibrancy::apply_acrylic;

mod commands;
mod protocol;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        // Remembers each window's size, position and maximised state across
        // runs. Restoration happens after window creation, which is why the
        // window is configured `"visible": false` — the plugin reveals it once
        // the saved geometry is applied, so it never flashes at the default
        // size first.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Steamworks' overlay hook creates native windows of its own, outside
        // tao's tracking — on at least some machines that stops the window
        // count from ever reaching zero, so the implicit "exit when the last
        // window closes" path never fires and the process (and its Steam
        // session) lingers after the window disappears. Forced explicitly
        // rather than relying on that heuristic.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Best-effort clean shutdown so Steam is told the session
                // ended rather than left to notice the process died on its
                // own. `try_unwrap` only succeeds with no in-flight command
                // holding a clone; if one is, the exit below still happens.
                if let Some(state) = window.try_state::<state::AppState>() {
                    if let Ok(mut guard) = state.steam.lock() {
                        if let Some(handle) = guard.take() {
                            if let Ok(handle) = Arc::try_unwrap(handle) {
                                let _ = handle.shutdown();
                            }
                        }
                    }
                }
                window.app_handle().exit(0);
            }
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
            commands::launch::register_protocol_handler,
            commands::launch::discover_steam_paths,
            commands::launch::open_steam,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::update::is_installed_copy,
        ])
        .setup(|app| {
            let state = app.state::<state::AppState>();

            // Resolve the registry to the app data directory, not to a bare
            // relative "tetra.db". A relative path is interpreted against the
            // process working directory, so the launcher silently used a
            // different database depending on how it was started — one under
            // target/debug when the exe was double-clicked, another in the repo
            // root under `tauri dev`. Favourites and discovered servers
            // appeared to vanish purely because of where the shortcut pointed.
            let db_path = app
                .path()
                .app_data_dir()
                .map(|dir| {
                    let _ = std::fs::create_dir_all(&dir);
                    dir.join("tetra.db")
                })
                .unwrap_or_else(|_| std::path::PathBuf::from("tetra.db"));

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
            // `MAX_IN_FLIGHT` bounds the whole app, not one code path.
            *state.prober.lock().unwrap() = Some(tetra_net::Prober::new(ProbeConfig::default()));

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

            // The window is created hidden so the window-state plugin can apply
            // saved geometry before it is painted. The plugin reveals it when
            // it restores state — but on a first run there is no state to
            // restore, so nothing would ever show it. Showing it here covers
            // that case; `show()` on an already-visible window is a no-op.
            let _ = window.show();

            app.listen("dzsa-protocol", protocol::handle_deep_link);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
