// Each entry gets an `allow-*` permission. Windows may call only the commands
// their capability lists, so this must match `invoke_handler` in src/lib.rs.
const COMMANDS: &[&str] = &[
    "get_server",
    "get_server_page",
    "get_servers_by_addr",
    "lookup_server",
    "server_mod_readiness",
    "check_server_mods",
    "get_unique_mods_summary",
    "unsubscribe_unique_mods",
    "toggle_favourite",
    "get_map_list",
    "get_server_counts",
    "registry_degraded",
    "registry_status",
    "launched_hidden",
    "discover_servers",
    "refresh_visible_servers",
    "server_list_source",
    "steam_init",
    "steam_connection_state",
    "steam_mod_states",
    "steam_download_progress",
    "steam_subscribe_mods",
    "steam_unsubscribe_mods",
    "launch_game",
    "verify_server_mods",
    "take_pending_connect",
    "discover_steam_paths",
    "validate_dayz_path",
    "open_steam",
    "dayz_running",
    "open_workshop_in_steam",
    "log_client",
    "get_subscribed_mods",
    "verify_subscribed_mods",
    "get_mod_usage",
    "get_cared_servers",
    "get_unique_mods_for",
    "get_servers_needing",
    "get_known_mods",
    "get_workshop_previews",
    "search_workshop_mods",
    "reinstall_subscribed_mod",
    "update_subscribed_mods",
    "open_mod_folder",
    "get_settings",
    "take_settings_recovered",
    "patch_settings",
    "set_ui_scale",
    "open_data_folder",
    "data_folder_path",
    "list_installed_themes",
    "get_theme",
    "validate_theme",
    "save_theme_copy",
    "update_theme_tokens",
    "delete_theme",
    "get_theme_settings_values",
    "set_theme_settings_value",
    "set_active_theme_id",
    "migrate_legacy_custom_themes",
    "import_theme_preview",
    "confirm_theme_install",
    "discard_theme_import",
    "export_theme",
    "arm_activation",
    "confirm_activation",
    "revert_activation",
    "get_activation_status",
    "watch_active_theme",
    "stop_watching_theme",
    "is_installed_copy",
];

fn main() {
    // A `.deb` install has no AppImage-style wrapper to set LD_LIBRARY_PATH
    // before exec, so libsteam_api.so (a vendored library, never a system
    // package) needs to be found via an RPATH baked into the binary
    // instead. Matches where `bundle.linux.deb.files` in tauri.conf.json
    // places it — `/usr/lib/tetra-launcher/`, alongside the binary at
    // `/usr/bin/tetra-launcher` — so `$ORIGIN/../lib/tetra-launcher`
    // resolves to it. Harmless for the AppImage build: linuxdeploy's own
    // LD_LIBRARY_PATH is still checked first regardless.
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/tetra-launcher");

    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build");
}
