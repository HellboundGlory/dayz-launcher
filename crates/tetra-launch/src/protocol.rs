use crate::error::ProtocolError;

#[cfg(windows)]
use winreg::enums::*;

/// Whether the OS's current `dzsa://` registration already names
/// `exe_path`, so a caller can skip re-registering when there's nothing to
/// change (M11, 2026-08-29 audit) — `register_dzsa_protocol` used to run
/// unconditionally on every launch, writing the same registry values
/// (Windows) or rewriting the same desktop file (Linux) whether or not
/// anything had actually changed.
#[cfg(windows)]
pub fn dzsa_registered_to(exe_path: &std::path::Path) -> bool {
    let hkcu = winreg::RegKey::predef(HKEY_CURRENT_USER);
    let Ok(cmd) = hkcu.open_subkey("Software\\Classes\\dzsa\\shell\\open\\command") else {
        return false;
    };
    let current: String = cmd.get_value("").unwrap_or_default();
    current == format!("\"{}\" \"%1\"", exe_path.display())
}

/// Same as the Windows [`dzsa_registered_to`], checking the desktop entry's
/// `Exec=` line instead of the registry.
#[cfg(target_os = "linux")]
pub fn dzsa_registered_to(exe_path: &std::path::Path) -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return false;
    };
    let desktop_file = std::path::PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("applications")
        .join("tetra-launcher-dzsa.desktop");
    let Ok(content) = std::fs::read_to_string(&desktop_file) else {
        return false;
    };
    desktop_entry_matches(&content, exe_path)
}

/// The string comparison behind [`dzsa_registered_to`] on Linux, split out
/// so it's testable without touching the real desktop-entry file (which
/// lives under the real `$HOME`, not a fixture directory).
#[cfg(target_os = "linux")]
fn desktop_entry_matches(content: &str, exe_path: &std::path::Path) -> bool {
    content.contains(&format!("Exec=\"{}\" %u", exe_path.display()))
}

/// Register `dzsa://` protocol handler in Windows registry.
///
/// Writes to `HKCU\Software\Classes\dzsa\` so the operating system knows
/// to open this launcher when a `dzsa://` link is clicked.
#[cfg(windows)]
pub fn register_dzsa_protocol(exe_path: &std::path::Path) -> Result<(), ProtocolError> {
    let hkcu = winreg::RegKey::predef(HKEY_CURRENT_USER);
    let (dzsa, _) = hkcu.create_subkey("Software\\Classes\\dzsa")?;
    dzsa.set_value("", &"URL: DayZ Standalone Launcher Protocol")?;
    dzsa.set_value("URL Protocol", &"")?;

    let (icon, _) = dzsa.create_subkey("DefaultIcon")?;
    icon.set_value("", &format!("\"{}\",0", exe_path.display()))?;

    let (cmd, _) = dzsa.create_subkey("shell\\open\\command")?;
    cmd.set_value("", &format!("\"{}\" \"%1\"", exe_path.display()))?;

    Ok(())
}

/// Register the `dzsa://` protocol handler on Linux via an XDG desktop entry.
///
/// Writes `~/.local/share/applications/tetra-launcher-dzsa.desktop` marking the
/// launcher as the handler for `x-scheme-handler/dzsa`, then tells the desktop
/// environment to use it. The Windows twin writes to the registry instead.
#[cfg(target_os = "linux")]
pub fn register_dzsa_protocol(exe_path: &std::path::Path) -> Result<(), ProtocolError> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| ProtocolError::InvalidUri("no HOME in environment".into()))?;
    let apps_dir = std::path::PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("applications");
    std::fs::create_dir_all(&apps_dir)?;

    let desktop_file = apps_dir.join("tetra-launcher-dzsa.desktop");
    let content = format!(
        "[Desktop Entry]\nType=Application\nName=Tetra Launcher\nComment=DayZ Standalone Launcher Protocol Handler\nExec=\"{}\" %u\nMimeType=x-scheme-handler/dzsa;\nNoDisplay=true\n",
        exe_path.display()
    );
    std::fs::write(&desktop_file, content)?;

    let _ = std::process::Command::new("xdg-mime")
        .args([
            "default",
            "tetra-launcher-dzsa.desktop",
            "x-scheme-handler/dzsa",
        ])
        .status();
    Ok(())
}

#[cfg(test)]
mod tests {
    // Scoped to Linux, not a plain `use super::*;` at module level: on
    // Windows this module's only test is the one below, which is itself
    // `#[cfg(target_os = "linux")]`'d out — an unconditional import here
    // would compile to nothing using it on Windows and fail `clippy -D
    // warnings`'s `unused_imports` (caught by the new release-workflow gate
    // itself, M15, before anything was published — no Windows machine was
    // available this session to catch it any earlier).
    #[cfg(target_os = "linux")]
    use super::*;

    /// `dzsa_registered_to`'s Linux comparison, pinned without touching the
    /// real desktop-entry file under `$HOME`. Content shaped exactly like
    /// what `register_dzsa_protocol` actually writes (see its `format!`
    /// above) so this fails if the two ever drift apart.
    #[cfg(target_os = "linux")]
    #[test]
    fn desktop_entry_match_is_exe_path_specific() {
        let this_exe = std::path::Path::new("/opt/tetra-launcher/tetra-launcher");
        let other_exe = std::path::Path::new("/tmp/some-other-build/tetra-launcher");
        let content = "[Desktop Entry]\nType=Application\nName=Tetra Launcher\n\
             Exec=\"/opt/tetra-launcher/tetra-launcher\" %u\nMimeType=x-scheme-handler/dzsa;\n";

        assert!(desktop_entry_matches(content, this_exe));
        assert!(!desktop_entry_matches(content, other_exe));
    }
}
