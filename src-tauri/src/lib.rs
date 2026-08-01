use std::sync::Arc;
use tauri::{Listener, Manager};
use window_vibrancy::apply_acrylic;
use tetra_net::ProbeConfig;
use tetra_registry::Registry;

mod commands;
mod state;
mod protocol;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // Remembers each window's size, position and maximised state across
        // runs. Restoration happens after window creation, which is why the
        // window is configured `"visible": false` — the plugin reveals it once
        // the saved geometry is applied, so it never flashes at the default
        // size first.
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            commands::server::get_server_details,
            commands::server::get_server_mods,
            commands::server::toggle_favourite,
            commands::server::get_map_list,
            commands::server::get_server_counts,
            commands::server::discover_servers,
            commands::server::refresh_servers,
            commands::steam::steam_init,
            commands::steam::steam_get_user,
            commands::steam::steam_connection_state,
            commands::steam::steam_mod_states,
            commands::steam::steam_download_progress,
            commands::steam::steam_subscribe_mods,
            commands::steam::steam_unsubscribe_mods,
            commands::launch::launch_game,
            commands::launch::launch_vanilla,
            commands::launch::register_protocol_handler,
            commands::launch::discover_steam_paths,
            commands::launch::open_steam,
            commands::settings::get_settings,
            commands::settings::save_settings,
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

            let registry = Registry::open(&db_path).unwrap_or_else(|e| {
                eprintln!("[setup] Could not open {}: {e}. Falling back to in-memory.", db_path.display());
                Registry::open_in_memory().expect("Failed to open in-memory registry")
            });
            eprintln!("[setup] Registry ready at {}", db_path.display());
            *state.registry.lock().unwrap() = Some(registry);

            // Initialize the Prober
            let config = ProbeConfig::default();
            *state.prober.lock().unwrap() = Some(tetra_net::Prober::new(config));

            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            apply_acrylic(&window, Some((18, 18, 18, 85)))
                .expect("Failed to apply acrylic effect on Windows");

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