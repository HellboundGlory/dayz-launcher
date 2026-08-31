/// Whether this copy lives in an NSIS/AppImage install location, vs a portable exe.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    // Linux ships as an AppImage, which the updater replaces in place.
    true
}

#[cfg(windows)]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };

    // Must match `productName` in tauri.conf.json.
    const PRODUCT_DIR: &str = "Tetra Launcher";

    for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        let Ok(root) = std::env::var(var) else {
            continue;
        };
        let installed_root = std::path::Path::new(&root).join(PRODUCT_DIR);
        if exe.starts_with(&installed_root) {
            return true;
        }
    }
    false
}

/// No macOS distribution model yet, so default to portable (`false`).
#[cfg(not(any(target_os = "linux", windows)))]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    false
}
