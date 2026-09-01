use crate::error::SpawnError;
use std::path::PathBuf;
use std::process::Command;

/// The BattlEye stub the game is launched through, and the game itself.
const BE_LAUNCHER_EXE: &str = "DayZ_BE.exe";
const GAME_EXE: &str = "DayZ_x64.exe";

/// The BattlEye launcher's own arguments, which must precede the game's.
/// Mirrors what the official DayZ launcher passes: `<update check> <game id>
/// <log mode> -exe <game exe>`. Left off, `DayZ_BE.exe` runs its own updater
/// (blocked by most firewalls, "Update Failed (1, 28)") and resolves the game
/// exe against its working directory instead of being told where it is.
fn battleye_prefix(exe_name: &str, game_exe_present: bool) -> Vec<String> {
    if !exe_name.eq_ignore_ascii_case(BE_LAUNCHER_EXE) {
        return Vec::new();
    }
    let mut args = vec!["0".to_string(), "1".to_string(), "0".to_string()];
    if game_exe_present {
        args.push("-exe".to_string());
        args.push(GAME_EXE.to_string());
    }
    args
}

/// [`battleye_prefix`] for a real path, checking the disk for the game exe.
fn battleye_args(exe_path: &std::path::Path) -> Vec<String> {
    let name = exe_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    battleye_prefix(name, exe_path.with_file_name(GAME_EXE).is_file())
}

/// Starts DayZ and returns immediately — doesn't `.wait()`, or JOIN/RECENT
/// would stay stuck until the player quit the game.
///
/// Runs from the DayZ folder: the BattlEye stub starts the game relative to
/// its working directory, and from anywhere else Windows refuses the launch
/// with "cannot access the specified device, path, or file".
#[cfg(windows)]
pub fn spawn_dayz(exe_path: &std::path::Path, args: &[String]) -> Result<(), SpawnError> {
    let mut cmd = Command::new(exe_path);
    if let Some(dir) = exe_path.parent() {
        cmd.current_dir(dir);
    }
    cmd.args(battleye_args(exe_path))
        .args(args)
        .spawn()
        .map(|_child| ())
        .map_err(SpawnError::Launch)
}

/// Start DayZ on Linux by running the Windows executable under Proton:
/// `<SteamLinuxRuntime_*>/run -- <Proton>/proton run <dayz_exe> <args...>`
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
        .args(battleye_args(exe_path))
        .args(args);

    if let Some(dir) = exe_path.parent() {
        cmd.current_dir(dir);
    }

    // Proton needs these or it aborts with a KeyError.
    cmd.env("STEAM_COMPAT_DATA_PATH", &compat_data);
    cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &steam_root);
    cmd.env("SteamAppId", "221100");
    cmd.env("SteamGameId", "221100");

    // Strip AppImage/leaked Python env vars that break the Steam-runtime child.
    cmd.env_remove("LD_LIBRARY_PATH");
    cmd.env_remove("APPIMAGE");
    cmd.env_remove("APPDIR");
    cmd.env_remove("PYTHONHOME");
    cmd.env_remove("PYTHONPATH");

    cmd.spawn().map(|_child| ()).map_err(SpawnError::Launch)
}

/// Locate an installed Proton build under `<steam>/steamapps/common`.
/// Picks the *best* candidate, not the lexicographically first — see [`best_proton`].
#[cfg(target_os = "linux")]
fn pick_proton(common: &std::path::Path) -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = std::fs::read_dir(common)
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
    best_proton(candidates)
}

/// Ranks candidate `.../<Proton dir>/proton` paths and returns the best one.
/// Experimental always wins; otherwise the highest numeric version does.
/// Split from [`pick_proton`] so the ranking is testable without a real
/// Steam install.
#[cfg(target_os = "linux")]
fn best_proton(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().max_by_key(|p| proton_rank(p))
}

/// `(is_experimental, version)`. Tuple `Ord` is lexicographic, so Experimental
/// (`true`) always outranks a numbered build regardless of version, and among
/// numbered builds the higher `(major, minor)` wins.
#[cfg(target_os = "linux")]
fn proton_rank(proton_binary: &std::path::Path) -> (bool, (u32, u32)) {
    let dir_name = proton_binary
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let experimental = dir_name.to_ascii_lowercase().contains("experimental");
    (experimental, parse_proton_version(dir_name))
}

/// Pulls `(major, minor)` from a directory name like `"Proton 9.0 (Beta)"`.
/// A non-numeric edition (Experimental, Hotfix, ...) parses as `(0, 0)`.
#[cfg(target_os = "linux")]
fn parse_proton_version(dir_name: &str) -> (u32, u32) {
    let after_prefix = dir_name.strip_prefix("Proton").unwrap_or(dir_name).trim();
    let version_token = after_prefix.split_whitespace().next().unwrap_or("");
    let mut parts = version_token.split('.');
    let major = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    (major, minor)
}

/// Locate a Steam Linux Runtime (scout/soldier/sniper) under
/// `<steam>/steamapps/common`. Picks the best candidate — see [`best_runtime`].
#[cfg(target_os = "linux")]
fn pick_runtime(common: &std::path::Path) -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = std::fs::read_dir(common)
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
    best_runtime(candidates)
}

/// Ranks candidate `.../<SteamLinuxRuntime*>/run` paths and returns the
/// best: `_sniper` > `_soldier` > bare (scout), since modern Proton builds
/// require sniper.
#[cfg(target_os = "linux")]
fn best_runtime(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().max_by_key(|p| runtime_rank(p))
}

#[cfg(target_os = "linux")]
fn runtime_rank(run_binary: &std::path::Path) -> u8 {
    let dir_name = run_binary
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if dir_name.ends_with("_sniper") {
        2
    } else if dir_name.ends_with("_soldier") {
        1
    } else {
        0
    }
}

/// Start the Steam client — doesn't wait, since its process stays alive for the whole session.
pub fn spawn_steam(exe_path: &std::path::Path) -> Result<(), SpawnError> {
    Command::new(exe_path)
        .spawn()
        .map(|_child| ())
        .map_err(SpawnError::Launch)
}

/// Start Steam handed a `steam://…` URL to open — a second instance forwards
/// it to the already-running client rather than starting twice.
pub fn spawn_steam_with_url(exe_path: &std::path::Path, url: &str) -> Result<(), SpawnError> {
    Command::new(exe_path)
        .arg(url)
        .spawn()
        .map(|_child| ())
        .map_err(SpawnError::Launch)
}

/// Locate the DayZ executable — prefers `DayZ_BE.exe`, falls back to `DayZ_x64.exe`.
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

    /// The BattlEye stub must be told not to self-update and which exe to
    /// start — the official launcher's `0 1 0 -exe DayZ_x64.exe`.
    #[test]
    fn battleye_stub_gets_the_official_launchers_prefix() {
        assert_eq!(
            battleye_prefix("DayZ_BE.exe", true),
            vec!["0", "1", "0", "-exe", "DayZ_x64.exe"]
        );
    }

    #[test]
    fn battleye_prefix_matches_the_stub_case_insensitively() {
        assert_eq!(
            battleye_prefix("dayz_be.exe", true),
            battleye_prefix("DayZ_BE.exe", true)
        );
    }

    /// Launching the game directly takes no BattlEye arguments — they would
    /// reach DayZ as unknown parameters.
    #[test]
    fn the_game_exe_gets_no_battleye_prefix() {
        assert!(battleye_prefix("DayZ_x64.exe", true).is_empty());
    }

    /// Without `DayZ_x64.exe` beside it there is nothing to point `-exe` at,
    /// so the stub falls back to finding the game itself.
    #[test]
    fn exe_is_omitted_when_the_game_is_not_beside_the_stub() {
        assert_eq!(battleye_prefix("DayZ_BE.exe", false), vec!["0", "1", "0"]);
    }

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

    /// `-mod=` must stay last — some builds read a trailing flag as part of the mod path.
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

    #[cfg(target_os = "linux")]
    mod proton_and_runtime_ranking {
        use super::*;

        fn proton(dir: &str) -> PathBuf {
            PathBuf::from(format!("/steam/steamapps/common/{dir}/proton"))
        }

        fn runtime(dir: &str) -> PathBuf {
            PathBuf::from(format!("/steam/steamapps/common/{dir}/run"))
        }

        #[test]
        fn a_higher_numeric_version_beats_a_lower_one_despite_sorting_first() {
            let candidates = vec![proton("Proton 9.0 (Beta)"), proton("Proton 5.13")];
            assert_eq!(best_proton(candidates), Some(proton("Proton 9.0 (Beta)")));
        }

        #[test]
        fn experimental_beats_every_numbered_build() {
            let candidates = vec![
                proton("Proton 9.0"),
                proton("Proton - Experimental"),
                proton("Proton 5.13"),
            ];
            assert_eq!(
                best_proton(candidates),
                Some(proton("Proton - Experimental"))
            );
        }

        #[test]
        fn a_non_numeric_edition_only_wins_when_nothing_else_is_installed() {
            let candidates = vec![proton("Proton Hotfix")];
            assert_eq!(best_proton(candidates), Some(proton("Proton Hotfix")));

            let candidates = vec![proton("Proton Hotfix"), proton("Proton 5.0")];
            assert_eq!(best_proton(candidates), Some(proton("Proton 5.0")));
        }

        #[test]
        fn sniper_beats_soldier_beats_scout() {
            let candidates = vec![
                runtime("SteamLinuxRuntime"),
                runtime("SteamLinuxRuntime_soldier"),
                runtime("SteamLinuxRuntime_sniper"),
            ];
            assert_eq!(
                best_runtime(candidates),
                Some(runtime("SteamLinuxRuntime_sniper"))
            );
        }

        #[test]
        fn bare_scout_is_not_mistaken_for_sniper_by_string_prefix() {
            let candidates = vec![
                runtime("SteamLinuxRuntime_sniper"),
                runtime("SteamLinuxRuntime"),
            ];
            assert_eq!(
                best_runtime(candidates),
                Some(runtime("SteamLinuxRuntime_sniper"))
            );
        }

        #[test]
        fn version_parsing_handles_bare_and_suffixed_names() {
            assert_eq!(parse_proton_version("Proton 9.0 (Beta)"), (9, 0));
            assert_eq!(parse_proton_version("Proton 5.13"), (5, 13));
            assert_eq!(parse_proton_version("Proton Hotfix"), (0, 0));
        }
    }
}
