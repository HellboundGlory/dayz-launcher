use crate::error::ProtocolError;

#[cfg(windows)]
use winreg::enums::*;

/// Whether the OS's current `dzsa://` registration already names
/// `exe_path`, so a caller can skip re-registering when nothing changed.
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
    let desktop_file = dzsa_desktop_file(env_var);
    if !desktop_file.is_absolute() {
        return false;
    }
    let Ok(content) = std::fs::read_to_string(&desktop_file) else {
        return false;
    };
    desktop_entry_matches(&content, exe_path)
}

/// `$XDG_DATA_HOME` when it is set to an absolute path, else `$HOME/.local/share`.
#[cfg(target_os = "linux")]
pub fn data_home(env: impl Fn(&str) -> Option<std::ffi::OsString>) -> std::path::PathBuf {
    if let Some(dir) = env("XDG_DATA_HOME").map(std::path::PathBuf::from) {
        if dir.is_absolute() {
            return dir;
        }
    }
    let home = env("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    home.join(".local").join("share")
}

#[cfg(target_os = "linux")]
fn env_var(name: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(name)
}

/// The `dzsa://` desktop entry inside the user's data home.
#[cfg(target_os = "linux")]
fn dzsa_desktop_file(env: impl Fn(&str) -> Option<std::ffi::OsString>) -> std::path::PathBuf {
    data_home(env)
        .join("applications")
        .join("tetra-launcher-dzsa.desktop")
}

/// The string comparison behind [`dzsa_registered_to`] on Linux, split out
/// so it's testable without touching the real desktop-entry file (which
/// lives under the real `$HOME`, not a fixture directory).
#[cfg(target_os = "linux")]
fn desktop_entry_matches(content: &str, exe_path: &std::path::Path) -> bool {
    let Some(exec) = desktop_exec_quote(exe_path) else {
        return false;
    };
    let line = format!("Exec={exec} %u");
    content.lines().any(|l| l == line)
}

/// One `Exec` argument as a desktop file stores it: double-quoted with `"`,
/// `` ` ``, `$` and `\` backslash-escaped and `%` doubled, then every backslash
/// doubled again because the value is also an escaped string. `None` for a
/// path that is not UTF-8 or holds a control character.
#[cfg(target_os = "linux")]
pub fn desktop_exec_quote(path: &std::path::Path) -> Option<String> {
    let text = path.to_str()?;
    if text.chars().any(char::is_control) {
        return None;
    }
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('"');
    for character in text.chars() {
        match character {
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(character);
            }
            '\\' => quoted.push_str("\\\\\\\\"),
            '%' => quoted.push_str("%%"),
            _ => quoted.push(character),
        }
    }
    quoted.push('"');
    Some(quoted)
}

#[cfg(target_os = "linux")]
fn dzsa_desktop_entry(exe_path: &std::path::Path) -> Option<String> {
    Some(format!(
        "[Desktop Entry]\nType=Application\nName=Tetra Launcher\nComment=DayZ Standalone Launcher Protocol Handler\nExec={} %u\nMimeType=x-scheme-handler/dzsa;\nNoDisplay=true\n",
        desktop_exec_quote(exe_path)?
    ))
}

/// Register the `dzsa://` handler under `HKCU\Software\Classes\dzsa\`.
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

/// Register the `dzsa://` handler on Linux via an XDG desktop entry in
/// [`data_home`]'s `applications` folder.
#[cfg(target_os = "linux")]
pub fn register_dzsa_protocol(exe_path: &std::path::Path) -> Result<(), ProtocolError> {
    let desktop_file = dzsa_desktop_file(env_var);
    let apps_dir = desktop_file
        .parent()
        .expect("the entry file always has a parent folder");
    if !apps_dir.is_absolute() {
        return Err(ProtocolError::InvalidUri(
            "no absolute data folder in the environment".into(),
        ));
    }
    std::fs::create_dir_all(apps_dir)?;

    let content = dzsa_desktop_entry(exe_path).ok_or_else(|| {
        ProtocolError::InvalidUri(format!(
            "{} cannot go in a desktop entry",
            exe_path.display()
        ))
    })?;
    std::fs::write(&desktop_file, content)?;

    let mut mime = std::process::Command::new("xdg-mime");
    mime.args([
        "default",
        "tetra-launcher-dzsa.desktop",
        "x-scheme-handler/dzsa",
    ]);
    crate::spawn::without_appimage_env(&mut mime);
    let _ = mime.status();
    Ok(())
}

#[cfg(test)]
mod tests {
    // Scoped to Linux: the only test below is Linux-only, so an unconditional
    // import here is unused on Windows and fails `clippy -D warnings`.
    #[cfg(target_os = "linux")]
    use super::*;

    #[cfg(target_os = "linux")]
    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<std::ffi::OsString> {
        let pairs: Vec<(String, std::ffi::OsString)> = pairs
            .iter()
            .map(|(name, value)| (name.to_string(), std::ffi::OsString::from(value)))
            .collect();
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn data_home_ignores_a_relative_xdg_data_home() {
        assert_eq!(
            data_home(env(&[
                ("XDG_DATA_HOME", "/srv/data"),
                ("HOME", "/home/tetra")
            ])),
            std::path::Path::new("/srv/data")
        );
        assert_eq!(
            data_home(env(&[
                ("XDG_DATA_HOME", "relative/data"),
                ("HOME", "/home/tetra")
            ])),
            std::path::Path::new("/home/tetra/.local/share")
        );
        assert_eq!(
            data_home(env(&[("HOME", "/home/tetra")])),
            std::path::Path::new("/home/tetra/.local/share")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_dzsa_entry_lives_under_the_xdg_data_home() {
        assert_eq!(
            dzsa_desktop_file(env(&[
                ("XDG_DATA_HOME", "/srv/data"),
                ("HOME", "/home/tetra")
            ])),
            std::path::Path::new("/srv/data/applications/tetra-launcher-dzsa.desktop")
        );
        assert_eq!(
            dzsa_desktop_file(env(&[("HOME", "/home/tetra")])),
            std::path::Path::new(
                "/home/tetra/.local/share/applications/tetra-launcher-dzsa.desktop"
            )
        );
    }

    /// Pinned against the exact format `register_dzsa_protocol` writes, so
    /// this fails if the two drift apart.
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

    #[cfg(target_os = "linux")]
    #[test]
    fn desktop_exec_quote_writes_one_quoted_argument() {
        // Expected values are the file's text: the Exec escape inside the
        // quotes, then the string escape that doubles each backslash.
        let cases: &[(&str, Option<&str>)] = &[
            (
                "/home/tetra/Applications/Tetra.AppImage",
                Some(r#""/home/tetra/Applications/Tetra.AppImage""#),
            ),
            (
                "/home/tetra/My Games/Tetra.AppImage",
                Some(r#""/home/tetra/My Games/Tetra.AppImage""#),
            ),
            ("/tmp/a\"b", Some(r#""/tmp/a\\"b""#)),
            ("/tmp/$HOME", Some(r#""/tmp/\\$HOME""#)),
            ("/tmp/a`b", Some(r#""/tmp/a\\`b""#)),
            ("/tmp/a\\b", Some(r#""/tmp/a\\\\b""#)),
            ("/tmp/100%.AppImage", Some(r#""/tmp/100%%.AppImage""#)),
            ("/tmp/a\nb", None),
        ];
        for (path, expected) in cases {
            assert_eq!(
                desktop_exec_quote(std::path::Path::new(path)).as_deref(),
                *expected,
                "path: {path:?}"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_dzsa_entry_for_an_awkward_path_matches_itself() {
        let exe = std::path::Path::new("/home/tetra/100% $ure/Tetra.AppImage");
        let entry = dzsa_desktop_entry(exe).unwrap();

        assert!(
            entry.contains("Exec=\"/home/tetra/100%% \\\\$ure/Tetra.AppImage\" %u\n"),
            "{entry}"
        );
        assert!(desktop_entry_matches(&entry, exe));
        assert!(dzsa_desktop_entry(std::path::Path::new("/tmp/a\nb")).is_none());
    }
}
