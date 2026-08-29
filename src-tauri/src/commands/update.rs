/// Whether this running copy lives in one of the NSIS installer's target
/// directories, as opposed to a portable exe unzipped somewhere arbitrary.
///
/// There is no flag baked into the binary itself — the installed and
/// portable distributions are the exact same exe, just packaged differently
/// — so this is a location heuristic instead. It only has to distinguish
/// "the installer put this here" from "the user could have put this
/// anywhere," which the two possible NSIS `installMode`s narrow to a
/// handful of well-known roots.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    // On Linux the shipped distribution is an AppImage, which the updater can
    // replace in place. Treat it as an installed copy so auto-update flows just
    // like the Windows NSIS build does.
    true
}

#[cfg(windows)]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };

    // Kept in sync with `productName` in `tauri.conf.json` — the NSIS
    // installer creates `<root>\Tetra Launcher\`.
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

/// L7 (2026-08-29 audit): this command is registered unconditionally in
/// `lib.rs`'s `generate_handler!`, but only the Linux and Windows arms above
/// existed — so a macOS build failed to compile with the symbol missing
/// entirely. No macOS distribution model is defined yet, so `false`
/// (portable) is the conservative default: the update flow points at the
/// GitHub release rather than assuming an in-place self-replace this
/// packaging has never been built to support.
#[cfg(not(any(target_os = "linux", windows)))]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    false
}
