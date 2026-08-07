use crate::error::SpawnError;
use std::path::PathBuf;
use std::process::Command;

/// Start DayZ with the given launch arguments and return as soon as the process
/// exists.
///
/// # Why this does not wait
///
/// It used to end in `.wait()`, which blocks until DayZ exits. Nothing wanted
/// that: the only caller discarded the `ExitStatus`, and waiting cost three
/// things. The Tauri command that calls this is `async`, so the wait pinned a
/// Tokio worker thread for the entire play session; the frontend's `launching`
/// flag is cleared when the command resolves, so the JOIN button read
/// "LAUNCHING..." until the player quit the game; and `mark_played` runs after
/// this returns, so a server only entered the RECENT list once the session was
/// over. `DayZ_BE.exe` masked it — the BattlEye stub exits quickly after
/// handing off — but an install with only `DayZ_x64.exe` hit all three.
///
/// # Safety
///
/// Arguments never pass through `cmd.exe` or any shell — `std::process::Command`
/// calls `CreateProcess` directly on Windows. Dropping the `Child` does not
/// terminate the process.
#[cfg(windows)]
pub fn spawn_dayz(exe_path: &std::path::Path, args: &[String]) -> Result<(), SpawnError> {
    Command::new(exe_path)
        .args(args)
        .spawn()
        .map(|_child| ())
        .map_err(SpawnError::Launch)
}

/// Start DayZ on Linux by running the Windows executable under Proton.
///
/// DayZ ships as a Windows binary, so on Linux it is launched through the same
/// Proton setup Steam uses. The Steam root is resolved from disk, then a Proton
/// build and its Steam Linux Runtime are located under
/// `<steam>/steamapps/common/`, and the game is run like:
///
/// ```text
/// <SteamLinuxRuntime_*>/run -- <Proton>/proton run <dayz_exe> <args...>
/// ```
///
/// `STEAM_COMPAT_DATA_PATH` points at the appid 221100 prefix so the launch
/// reuses the exact prefix Steam would have created for a normal DayZ run.
#[cfg(target_os = "linux")]
pub fn spawn_dayz(exe_path: &std::path::Path, args: &[String]) -> Result<(), SpawnError> {
    let steam_root = crate::registry_discovery::find_steam_paths()
        .map(|p| p.steam_install)
        .unwrap_or_else(|| {
            std::env::var_os("XDG_DATA_HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                        .join(".local")
                        .join("share")
                })
                .join("Steam")
        });

    let common = steam_root.join("steamapps").join("common");

    let proton = pick_proton(&common).ok_or_else(|| {
        SpawnError::Launch(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no installed Proton build found under Steam steamapps/common",
        ))
    })?;
    let runtime = pick_runtime(&common).ok_or_else(|| {
        SpawnError::Launch(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no Steam Linux Runtime found under Steam steamapps/common",
        ))
    })?;

    let compat_data = steam_root
        .join("steamapps")
        .join("compatdata")
        .join("221100");

    let mut cmd = Command::new(&runtime);
    cmd.arg("--")
        .arg(&proton)
        .arg("run")
        .arg(exe_path)
        .args(args);

    // The Steam client sets these when it launches a game normally; invoking
    // Proton outside Steam means the `proton` script needs them to set up the
    // WINEPREFIX and find the Steam install. Without them proton aborts with a
    // "STEAM_COMPAT_CLIENT_INSTALL_PATH" KeyError.
    cmd.env("STEAM_COMPAT_DATA_PATH", &compat_data);
    cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &steam_root);
    cmd.env("SteamAppId", "221100");
    cmd.env("SteamGameId", "221100");

    // When the launcher itself runs from an AppImage, the runtime injects
    // LD_LIBRARY_PATH (and APPIMAGE/APPDIR) pointing at the AppImage's bundled
    // libraries, which breaks the Steam-runtime child. Strip them so the child
    // uses the system libraries Steam expects.
    cmd.env_remove("LD_LIBRARY_PATH");
    cmd.env_remove("APPIMAGE");
    cmd.env_remove("APPDIR");
    // A leaked PYTHONHOME/PYTHONPATH breaks the runtime's system Python
    // ("No module named 'encodings'").
    cmd.env_remove("PYTHONHOME");
    cmd.env_remove("PYTHONPATH");

    cmd.spawn().map(|_child| ()).map_err(SpawnError::Launch)
}

/// Locate an installed Proton build under `<steam>/steamapps/common`.
#[cfg(target_os = "linux")]
fn pick_proton(common: &std::path::Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(common)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with("Proton")
        })
        .map(|p| p.join("proton"))
        .filter(|p| p.is_file())
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

/// Locate a Steam Linux Runtime (soldier/sniper) under `<steam>/steamapps/common`.
#[cfg(target_os = "linux")]
fn pick_runtime(common: &std::path::Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(common)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with("SteamLinuxRuntime")
        })
        .map(|p| p.join("run"))
        .filter(|p| p.is_file())
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

/// Start the Steam client and return immediately.
///
/// Steam's first process stays alive for the whole session, so waiting on it
/// would block the caller until the user quit Steam.
pub fn spawn_steam(exe_path: &std::path::Path) -> Result<(), SpawnError> {
    Command::new(exe_path)
        .spawn()
        .map(|_child| ())
        .map_err(SpawnError::Launch)
}

/// Locate the DayZ executable.
///
/// Prefers `DayZ_BE.exe` (BattlEye-enabled) if it exists, falls back to
/// `DayZ_x64.exe`.
pub fn find_dayz_exe(dayz_dir: &std::path::Path) -> Option<PathBuf> {
    let be = dayz_dir.join("DayZ_BE.exe");
    if be.exists() {
        return Some(be);
    }
    let x64 = dayz_dir.join("DayZ_x64.exe");
    if x64.exists() {
        return Some(x64);
    }
    None
}

/// Build the full argument list for a DayZ launch.
///
/// # Arguments
///
/// - `main_menu` — `true` launches DayZ to the main menu with the mods loaded
///   instead of joining the server: the connection arguments are omitted.
/// - `server_ip` — The server to connect to (game port, not query port).
/// - `server_port` — Game port.
/// - `password` — Optional server password.
/// - `mod_arg` — The full `-mod=...` string (or empty for vanilla).
/// - `extra_params` — User-configured launch parameters (e.g. `-noSplash`).
///
/// The mod argument is always last in the list so the user's parameters
/// cannot accidentally truncate or interfere with it.
pub fn build_launch_args(
    main_menu: bool,
    server_ip: &str,
    server_port: u16,
    password: Option<&str>,
    mod_arg: &str,
    extra_params: &[String],
    profile_name: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // Server connection — skipped for a main-menu launch, which must reach the
    // menu rather than connect. `-password` goes with the connection, so it is
    // dropped too: there is no server to hand it to.
    if !main_menu {
        args.push(format!("-connect={server_ip}"));
        args.push(format!("-port={server_port}"));

        if let Some(pw) = password {
            args.push(format!("-password={pw}"));
        }
    }

    if let Some(name) = profile_name {
        args.push(format!("-name={name}"));
    }

    // User's extra launch parameters
    for param in extra_params {
        args.push(param.clone());
    }

    // Mod line goes last
    if !mod_arg.is_empty() {
        args.push(mod_arg.to_string());
    }

    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vanilla_launch_no_extra_params() {
        let args = build_launch_args(false, "127.0.0.1", 2302, None, "", &[], None);
        assert_eq!(args, vec!["-connect=127.0.0.1", "-port=2302"]);
    }

    #[test]
    fn launch_with_name_and_mods() {
        let args = build_launch_args(
            false,
            "192.168.1.1",
            27016,
            Some("hunter2"),
            "-mod=C:\\mods\\@test",
            &["-noSplash".into()],
            Some("Survivor"),
        );
        assert_eq!(
            args,
            vec![
                "-connect=192.168.1.1",
                "-port=27016",
                "-password=hunter2",
                "-name=Survivor",
                "-noSplash",
                "-mod=C:\\mods\\@test"
            ]
        );
    }

    #[test]
    fn mod_arg_given_even_when_empty() {
        let args = build_launch_args(false, "10.0.0.1", 2302, None, "", &[], None);
        assert!(!args.contains(&String::from("-mod=")));
    }

    #[test]
    fn name_omitted_when_none() {
        let args = build_launch_args(false, "127.0.0.1", 2302, None, "", &[], None);
        assert!(!args.iter().any(|a| a.starts_with("-name=")));
    }

    /// The user's own parameters must never land after `-mod=`.
    ///
    /// DayZ takes the mod line as one argument, and a flag placed after it is
    /// read by some builds as part of the final mod path. Keeping `-mod=` last
    /// is why `build_launch_args` appends it rather than interleaving.
    #[test]
    fn user_parameters_precede_the_mod_line() {
        let args = build_launch_args(
            false,
            "127.0.0.1",
            2302,
            None,
            "-mod=C:\\mods\\@a;C:\\mods\\@b",
            &[
                "-noSplash".into(),
                "-skipIntro".into(),
                "-cpuCount=4".into(),
            ],
            None,
        );

        let mod_index = args.iter().position(|a| a.starts_with("-mod=")).unwrap();
        assert_eq!(
            mod_index,
            args.len() - 1,
            "-mod= must be the final argument"
        );
        for flag in ["-noSplash", "-skipIntro", "-cpuCount=4"] {
            let at = args
                .iter()
                .position(|a| a == flag)
                .expect("flag was dropped");
            assert!(at < mod_index, "{flag} must come before -mod=");
        }
    }

    /// Regression guard for the wiring bug this audit fixed: `commands::launch`
    /// passed a hardcoded `&[]` here, so a populated `launchParams` setting
    /// serialised to disk, round-tripped through the store, and was then
    /// silently dropped on the way to the command line.
    #[test]
    fn every_supplied_parameter_reaches_the_command_line() {
        let extra: Vec<String> = vec!["-noSplash".into(), "-window".into()];
        let args = build_launch_args(false, "127.0.0.1", 2302, None, "", &extra, None);
        for flag in &extra {
            assert!(args.contains(flag), "{flag} was dropped");
        }
    }

    /// A main-menu launch must not carry any server-connection argument, while
    /// still loading the mods and the user's launch parameters.
    #[test]
    fn main_menu_launch_omits_connection_but_keeps_mods() {
        let args = build_launch_args(
            true,
            "127.0.0.1",
            2302,
            Some("hunter2"),
            "-mod=C:\\mods\\@a;C:\\mods\\@b",
            &["-noSplash".into()],
            Some("Survivor"),
        );
        assert!(
            !args.iter().any(|a| a.starts_with("-connect=")),
            "-connect= must be omitted in main-menu mode"
        );
        assert!(
            !args.iter().any(|a| a.starts_with("-port=")),
            "-port= must be omitted in main-menu mode"
        );
        assert!(
            !args.iter().any(|a| a.starts_with("-password=")),
            "-password= must be omitted in main-menu mode"
        );
        assert!(
            args.iter().any(|a| a.starts_with("-mod=")),
            "-mod= must still be present in main-menu mode"
        );
        assert!(
            args.iter().any(|a| a == "-noSplash"),
            "user launch parameters must still reach main-menu mode"
        );
    }
}
