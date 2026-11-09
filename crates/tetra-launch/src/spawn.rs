use crate::error::SpawnError;
use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};
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
///
/// When Proton or its runtime is missing (a Flatpak Steam, or one where DayZ
/// was never run) the launch is handed to Steam instead, which installs Proton
/// itself. That route splits values at spaces, so [`check_applaunch_args`] can
/// refuse it.
#[cfg(target_os = "linux")]
pub fn spawn_dayz(exe_path: &std::path::Path, args: &[String]) -> Result<(), SpawnError> {
    let steam_root = crate::registry_discovery::find_native_steam_paths()
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

    match choose_route(&common) {
        LinuxRoute::Proton { proton, runtime } => {
            spawn_proton(&steam_root, exe_path, args, &proton, &runtime)
        }
        LinuxRoute::Steam => {
            let install = crate::registry_discovery::find_steam_install().ok_or_else(|| {
                SpawnError::Launch(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "no installed Proton build found under Steam steamapps/common",
                ))
            })?;
            let (program, launch_args) = applaunch_command(&install, args)?;
            let mut cmd = Command::new(program);
            cmd.args(launch_args);
            without_appimage_env(&mut cmd);
            cmd.spawn().map(|_child| ()).map_err(SpawnError::Launch)
        }
    }
}

/// Which Linux launch path a Steam install allows.
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, PartialEq, Eq)]
enum LinuxRoute {
    Proton { proton: PathBuf, runtime: PathBuf },
    Steam,
}

/// Proton only when both it and its runtime are installed; otherwise Steam runs the game itself.
#[cfg(target_os = "linux")]
fn choose_route(common: &std::path::Path) -> LinuxRoute {
    match (pick_proton(common), pick_runtime(common)) {
        (Some(proton), Some(runtime)) => LinuxRoute::Proton { proton, runtime },
        _ => LinuxRoute::Steam,
    }
}

#[cfg(target_os = "linux")]
fn spawn_proton(
    steam_root: &std::path::Path,
    exe_path: &std::path::Path,
    args: &[String],
    proton: &std::path::Path,
    runtime: &std::path::Path,
) -> Result<(), SpawnError> {
    let compat_data = steam_root
        .join("steamapps")
        .join("compatdata")
        .join("221100");

    let mut cmd = Command::new(runtime);
    cmd.arg("--")
        .arg(proton)
        .arg("run")
        .arg(exe_path)
        .args(battleye_args(exe_path))
        .args(args);

    if let Some(dir) = exe_path.parent() {
        cmd.current_dir(dir);
    }

    without_appimage_env(&mut cmd);

    // Proton needs these or it aborts with a KeyError.
    cmd.env("STEAM_COMPAT_DATA_PATH", &compat_data);
    cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", steam_root);
    cmd.env("SteamAppId", "221100");
    cmd.env("SteamGameId", "221100");

    cmd.spawn().map(|_child| ()).map_err(SpawnError::Launch)
}

/// App ID of DayZ on Steam.
#[cfg(target_os = "linux")]
const DAYZ_APP_ID: &str = "221100";

/// Steam's launch-line limit, in characters, with room to spare.
#[cfg(target_os = "linux")]
const APPLAUNCH_LIMIT: usize = 900;

/// The program and argument list for `steam -applaunch`, as a list so no value
/// is ever re-split by a shell.
#[cfg(target_os = "linux")]
fn applaunch_command(
    install: &crate::registry_discovery::SteamInstall,
    args: &[String],
) -> Result<(OsString, Vec<OsString>), SpawnError> {
    use crate::registry_discovery::SteamInstall;

    check_applaunch_args(args, matches!(install, SteamInstall::Flatpak))?;

    let mut full: Vec<OsString> = Vec::new();
    let program = match install {
        SteamInstall::Native(path) => path.as_os_str().to_owned(),
        SteamInstall::Flatpak => {
            full.extend(["run".into(), "com.valvesoftware.Steam".into()]);
            OsString::from("flatpak")
        }
    };
    full.push("-applaunch".into());
    full.push(DAYZ_APP_ID.into());
    full.extend(args.iter().map(OsString::from));
    Ok((program, full))
}

/// Refuse a launch Steam would split apart or truncate, with advice that fits
/// the install: native Steam can get the Proton route, Flatpak Steam can't.
#[cfg(target_os = "linux")]
fn check_applaunch_args(args: &[String], flatpak: bool) -> Result<(), SpawnError> {
    let advice = if flatpak {
        "Tetra can't start Proton inside Flatpak Steam, so remove the space or shorten the mod list, \
         or install the native Steam package."
    } else {
        "Run DayZ once from Steam so it installs Proton, then Join here again; \
         that route has no such limit."
    };

    for arg in args {
        let Some((prefix, value)) = arg.split_once('=') else {
            if arg.chars().any(char::is_whitespace) {
                return Err(refused_parameter(arg, arg, advice));
            }
            continue;
        };
        if !value.chars().any(char::is_whitespace) {
            continue;
        }
        let prefix = prefix.to_ascii_lowercase();
        if prefix.contains("pass") {
            return Err(SpawnError::Refused(format!(
                "Can't start DayZ through Steam: the server password contains a space. \
                 Steam splits launch values at spaces. {advice}"
            )));
        }
        match prefix.as_str() {
            "-name" => {
                return Err(SpawnError::Refused(format!(
                    "Can't start DayZ through Steam: your in-game name contains a space (\"{value}\"). \
                     Steam splits launch values at spaces. {advice}"
                )))
            }
            "-profiles" => {
                return Err(SpawnError::Refused(format!(
                    "Can't start DayZ through Steam: the profiles folder path contains a space (\"{value}\"). \
                     Steam splits launch values at spaces. {advice}"
                )))
            }
            "-mod" => {
                let segment = value
                    .split(';')
                    .find(|part| part.chars().any(char::is_whitespace))
                    .unwrap_or(value);
                return Err(SpawnError::Refused(format!(
                    "Can't start DayZ through Steam: a mod path contains a space (\"{segment}\"). \
                     Steam splits launch values at spaces. {advice}"
                )));
            }
            _ => return Err(refused_parameter(arg, value, advice)),
        }
    }

    let line: String = args.join(" ");
    let length = line.chars().count();
    if length > APPLAUNCH_LIMIT {
        return Err(SpawnError::Refused(format!(
            "Can't start DayZ through Steam: the launch line is {length} characters and Steam's \
             limit is about {APPLAUNCH_LIMIT} (mostly the mod list). {advice}"
        )));
    }
    Ok(())
}

/// Arg whose value is shown in quotes: an unrelated parameter that itself has a space.
#[cfg(target_os = "linux")]
fn refused_parameter(arg: &str, value: &str, advice: &str) -> SpawnError {
    SpawnError::Refused(format!(
        "Can't start DayZ through Steam: the launch parameter `{arg}` contains a space (\"{value}\"). \
         Steam splits launch values at spaces. {advice}"
    ))
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

/// Remove the environment an AppImage adds, so programs it starts use the
/// machine's own libraries and data directories instead of the mount point's.
pub fn without_appimage_env(cmd: &mut Command) -> &mut Command {
    for name in [
        "LD_LIBRARY_PATH",
        "APPIMAGE",
        "APPDIR",
        "PYTHONHOME",
        "PYTHONPATH",
    ] {
        cmd.env_remove(name);
    }

    let appdir = std::env::var_os("APPDIR").filter(|value| !value.is_empty());
    let appdir_path = appdir.as_deref().map(Path::new);
    for name in ["PATH", "XDG_DATA_DIRS"] {
        let Some(value) = std::env::var_os(name) else {
            continue;
        };
        if std::env::split_paths(&value).any(|entry| is_appimage_entry(&entry, appdir_path)) {
            cmd.env(name, strip_appimage_entries(&value, appdir.as_deref()));
        }
    }
    cmd
}

/// [`without_appimage_env`] for one `PATH`-style value: drop the entries
/// under `appdir` and those inside an AppImage mount point.
fn strip_appimage_entries(value: &OsStr, appdir: Option<&OsStr>) -> OsString {
    let appdir = appdir.filter(|dir| !dir.is_empty()).map(Path::new);
    let kept: Vec<PathBuf> = std::env::split_paths(value)
        .filter(|entry| !is_appimage_entry(entry, appdir))
        .collect();
    std::env::join_paths(&kept).unwrap_or_else(|_| value.to_owned())
}

fn is_appimage_entry(entry: &Path, appdir: Option<&Path>) -> bool {
    appdir.is_some_and(|dir| entry.starts_with(dir)) || in_appimage_mount(entry)
}

fn in_appimage_mount(entry: &Path) -> bool {
    entry.components().any(|component| match component {
        Component::Normal(name) => name.to_string_lossy().starts_with(".mount_"),
        _ => false,
    })
}

/// Start the Steam client — doesn't wait, since its process stays alive for the whole session.
pub fn spawn_steam(exe_path: &std::path::Path) -> Result<(), SpawnError> {
    let mut cmd = Command::new(exe_path);
    without_appimage_env(&mut cmd);
    cmd.spawn().map(|_child| ()).map_err(SpawnError::Launch)
}

/// Start Steam handed a `steam://…` URL to open — a second instance forwards
/// it to the already-running client rather than starting twice.
pub fn spawn_steam_with_url(exe_path: &std::path::Path, url: &str) -> Result<(), SpawnError> {
    let mut cmd = Command::new(exe_path);
    cmd.arg(url);
    without_appimage_env(&mut cmd);
    cmd.spawn().map(|_child| ()).map_err(SpawnError::Launch)
}

/// Show a file or folder in the desktop's own file manager, without waiting.
pub fn open_with_desktop(target: &OsStr) -> Result<(), SpawnError> {
    // The system copy by full path: a bare name is looked up next to the
    // launcher first, where a planted explorer.exe would run instead.
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new(
        std::env::var_os("SystemRoot")
            .map(|root| PathBuf::from(root).join("explorer.exe"))
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows\explorer.exe")),
    );
    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(target);
    without_appimage_env(&mut cmd);
    let mut child = cmd.spawn().map_err(SpawnError::Launch)?;
    // Reap it in the background so each click leaves no zombie behind.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
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
/// `main_menu` launches to the main menu with the mods loaded and omits the connection
/// arguments. `server_port` is the game port, not the query port. `mod_arg` is the whole
/// `-mod=...` string, or empty for vanilla. It goes last so user parameters cannot truncate or interfere with it.
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
    /// start — the official launcher's `0 1 0 -exe DayZ_x64.exe` — while the
    /// game exe itself takes no BattlEye arguments.
    #[test]
    fn battleye_arguments_follow_the_stub_and_the_game_beside_it() {
        let cases: &[(&str, bool, &[&str])] = &[
            (
                "DayZ_BE.exe",
                true,
                &["0", "1", "0", "-exe", "DayZ_x64.exe"],
            ),
            // The stub's name arrives in whatever case the filesystem gave it.
            (
                "dayz_be.exe",
                true,
                &["0", "1", "0", "-exe", "DayZ_x64.exe"],
            ),
            ("DayZ_x64.exe", true, &[]),
            // Without `DayZ_x64.exe` beside it there is nothing to point
            // `-exe` at, so the stub falls back to finding the game itself.
            ("DayZ_BE.exe", false, &["0", "1", "0"]),
        ];
        for (exe_name, game_exe_present, expected) in cases {
            let expected: Vec<String> = expected.iter().map(|a| a.to_string()).collect();
            assert_eq!(
                battleye_prefix(exe_name, *game_exe_present),
                expected,
                "exe: {exe_name}, game exe beside it: {game_exe_present}"
            );
        }
    }

    #[test]
    fn vanilla_launch_no_extra_params() {
        let args = build_launch_args(false, "127.0.0.1", 2302, None, "", &[], None);
        assert_eq!(args, vec!["-connect=127.0.0.1", "-port=2302"]);
    }

    /// Every child runs without the AppImage's own environment, or Steam and
    /// the desktop opener try to use the launcher's mount point.
    #[test]
    fn without_appimage_env_clears_the_appimage_variables() {
        let mut cmd = Command::new("true");
        without_appimage_env(&mut cmd);

        let envs: Vec<(OsString, Option<OsString>)> = cmd
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(OsStr::to_owned)))
            .collect();
        for name in [
            "LD_LIBRARY_PATH",
            "APPIMAGE",
            "APPDIR",
            "PYTHONHOME",
            "PYTHONPATH",
        ] {
            assert!(
                envs.contains(&(OsString::from(name), None)),
                "{name} must be removed from the child"
            );
        }
    }

    /// AppImage entries are the mount point's own paths and anything under
    /// `$APPDIR`; a normal `PATH` is left exactly as it was.
    #[test]
    fn strip_appimage_entries_drops_only_the_appimage_paths() {
        type Case<'a> = (&'a [&'a str], Option<&'a str>, Option<&'a [&'a str]>);
        let cases: &[Case<'_>] = &[
            (
                &["/tmp/.mount_TetraXyz/usr/bin", "/usr/bin", "/bin"],
                None,
                Some(&["/usr/bin", "/bin"]),
            ),
            (
                &["/opt/app/usr/lib", "/usr/lib"],
                Some("/opt/app"),
                Some(&["/usr/lib"]),
            ),
            (&["/usr/bin", "/bin"], Some("/opt/app"), None),
        ];
        for (entries, appdir, expected) in cases {
            let value = std::env::join_paths(entries.iter()).unwrap();
            let stripped = strip_appimage_entries(&value, appdir.map(OsStr::new));
            let want = match expected {
                Some(kept) => std::env::join_paths(kept.iter()).unwrap(),
                None => value.clone(),
            };
            assert_eq!(stripped, want, "entries: {entries:?}, appdir: {appdir:?}");
        }
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
    mod steam_applaunch {
        use super::*;
        use crate::registry_discovery::SteamInstall;

        #[test]
        fn the_command_names_the_steam_install_it_goes_through() {
            let args: Vec<String> = ["-connect=1.2.3.4", "-port=2302", "-mod=Z:\\a\\b"]
                .iter()
                .map(|a| a.to_string())
                .collect();
            let (program, full) = applaunch_command(
                &SteamInstall::Native(PathBuf::from("/home/u/.local/share/Steam/steam.sh")),
                &args,
            )
            .expect("no refusal");
            assert_eq!(
                program,
                OsString::from("/home/u/.local/share/Steam/steam.sh")
            );
            assert_eq!(
                full,
                [
                    "-applaunch",
                    "221100",
                    "-connect=1.2.3.4",
                    "-port=2302",
                    "-mod=Z:\\a\\b"
                ]
                .map(OsString::from)
                .to_vec()
            );

            let (program, full) =
                applaunch_command(&SteamInstall::Flatpak, &args).expect("no refusal");
            assert_eq!(program, OsString::from("flatpak"));
            assert_eq!(
                full,
                [
                    "run",
                    "com.valvesoftware.Steam",
                    "-applaunch",
                    "221100",
                    "-connect=1.2.3.4",
                    "-port=2302",
                    "-mod=Z:\\a\\b"
                ]
                .map(OsString::from)
                .to_vec()
            );
        }

        fn refusal(args: &[&str]) -> String {
            let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
            match check_applaunch_args(&args, false) {
                Err(SpawnError::Refused(message)) => message,
                other => panic!("expected a refusal, got {other:?}"),
            }
        }

        #[test]
        fn flatpak_steam_gets_advice_it_can_follow() {
            let args = vec!["-name=Dead Man".to_string()];
            match check_applaunch_args(&args, true) {
                Err(SpawnError::Refused(message)) => {
                    assert!(!message.contains("Run DayZ once from Steam"), "{message}");
                    assert!(message.contains("native Steam"), "{message}");
                }
                other => panic!("expected a refusal, got {other:?}"),
            }
        }

        #[test]
        fn a_hand_typed_password_in_any_case_is_never_shown() {
            for arg in [
                "-Password=my pass",
                "-PASSWORD=my pass",
                "-serverpassword=my pass",
            ] {
                let message = refusal(&[arg]);
                assert!(!message.contains("my pass"), "{arg}: {message}");
            }
        }

        #[test]
        fn a_value_with_a_space_is_refused_by_name() {
            let cases: &[(&[&str], &str)] = &[
                (&["-name=Dead Man"], "your in-game name"),
                (&["-password=a b"], "the server password"),
                (&["-profiles=C:\\My Docs"], "the profiles folder path"),
                (&["-mod=Z:\\a\\b;Z:\\My Mods\\c"], "a mod path"),
            ];
            for (args, what) in cases {
                let message = refusal(args);
                assert!(
                    message.contains(&format!("{what} contains a space")),
                    "{args:?}: {message}"
                );
                assert!(message.contains("Run DayZ once from Steam"), "{message}");
            }

            let message = refusal(&["-name=Dead Man"]);
            assert!(message.contains("\"Dead Man\""), "{message}");

            let message = refusal(&["-mod=Z:\\a\\b;Z:\\My Mods\\c"]);
            assert!(message.contains("Z:\\My Mods\\c"), "{message}");
            assert!(
                !message.contains("Z:\\a\\b"),
                "only the spaced segment is named: {message}"
            );
        }

        #[test]
        fn the_password_value_is_never_printed() {
            let message = refusal(&["-password=hunter two"]);
            assert!(!message.contains("hunter"), "{message}");
            assert!(!message.contains("two"), "{message}");
        }

        #[test]
        fn an_unknown_parameter_is_refused_as_it_reads() {
            let message = refusal(&["-cpuCount=4 8"]);
            assert!(
                message.contains("the launch parameter `-cpuCount=4 8`"),
                "{message}"
            );
            assert!(message.contains("\"4 8\""), "{message}");
        }

        #[test]
        fn a_bare_parameter_with_a_space_is_refused_in_full() {
            let message = refusal(&["--some flag"]);
            assert!(
                message.contains("the launch parameter `--some flag`"),
                "{message}"
            );
            assert!(message.contains("\"--some flag\""), "{message}");
        }

        #[test]
        fn any_whitespace_counts_as_a_space() {
            let message = refusal(&["-name=Dead\tMan"]);
            assert!(
                message.contains("your in-game name contains a space"),
                "{message}"
            );
        }

        #[test]
        fn the_launch_line_limit_counts_characters() {
            let at_limit = String::from("-connect=") + &"a".repeat(900 - "-connect=".len());
            assert_eq!(at_limit.chars().count(), 900);
            assert!(check_applaunch_args(std::slice::from_ref(&at_limit), false).is_ok());

            let over = String::from("-connect=") + &"a".repeat(901 - "-connect=".len());
            let args = vec![over];
            match check_applaunch_args(&args, false) {
                Err(SpawnError::Refused(message)) => {
                    assert!(message.contains("901 characters"), "{message}");
                    assert!(message.contains("about 900"), "{message}");
                }
                other => panic!("expected a refusal, got {other:?}"),
            }
        }

        struct ScratchCommon(PathBuf);

        impl ScratchCommon {
            fn new() -> Self {
                use std::sync::atomic::{AtomicU64, Ordering};
                static N: AtomicU64 = AtomicU64::new(0);
                let id = N.fetch_add(1, Ordering::Relaxed);
                let dir = std::env::temp_dir()
                    .join(format!("tetra-steam-common-{}-{id}", std::process::id()));
                let _ = std::fs::remove_dir_all(&dir);
                std::fs::create_dir_all(&dir).expect("could not create scratch folder");
                Self(dir)
            }

            fn touch(&self, rel: &str) {
                let path = self.0.join(rel);
                std::fs::create_dir_all(path.parent().unwrap()).expect("could not create folder");
                std::fs::write(path, b"").expect("could not create file");
            }
        }

        impl Drop for ScratchCommon {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        #[test]
        fn a_proton_and_runtime_pair_picks_the_proton_route() {
            let common = ScratchCommon::new();
            common.touch("Proton 9.0/proton");
            common.touch("SteamLinuxRuntime_sniper/run");
            assert_eq!(
                choose_route(&common.0),
                LinuxRoute::Proton {
                    proton: common.0.join("Proton 9.0/proton"),
                    runtime: common.0.join("SteamLinuxRuntime_sniper/run"),
                }
            );
        }

        #[test]
        fn a_missing_proton_or_runtime_picks_the_steam_route() {
            let empty = ScratchCommon::new();
            assert_eq!(choose_route(&empty.0), LinuxRoute::Steam);

            let proton_only = ScratchCommon::new();
            proton_only.touch("Proton 9.0/proton");
            assert_eq!(choose_route(&proton_only.0), LinuxRoute::Steam);

            let runtime_only = ScratchCommon::new();
            runtime_only.touch("SteamLinuxRuntime_sniper/run");
            assert_eq!(choose_route(&runtime_only.0), LinuxRoute::Steam);
        }
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
        fn the_best_proton_is_experimental_then_the_highest_numbered_build() {
            let cases: &[(&[&str], &str)] = &[
                (&["Proton 9.0 (Beta)", "Proton 5.13"], "Proton 9.0 (Beta)"),
                (
                    &["Proton 9.0", "Proton - Experimental", "Proton 5.13"],
                    "Proton - Experimental",
                ),
                // A non-numeric edition only wins when nothing else is installed.
                (&["Proton Hotfix"], "Proton Hotfix"),
                (&["Proton Hotfix", "Proton 5.0"], "Proton 5.0"),
            ];
            for (installed, expected) in cases {
                let candidates = installed.iter().map(|dir| proton(dir)).collect();
                assert_eq!(
                    best_proton(candidates),
                    Some(proton(expected)),
                    "installed: {installed:?}"
                );
            }
        }

        #[test]
        fn sniper_beats_soldier_beats_the_bare_runtime() {
            let cases: &[(&[&str], &str)] = &[
                (
                    &[
                        "SteamLinuxRuntime",
                        "SteamLinuxRuntime_soldier",
                        "SteamLinuxRuntime_sniper",
                    ],
                    "SteamLinuxRuntime_sniper",
                ),
                // The bare runtime is scout, not a prefix match for sniper.
                (
                    &["SteamLinuxRuntime_sniper", "SteamLinuxRuntime"],
                    "SteamLinuxRuntime_sniper",
                ),
            ];
            for (installed, expected) in cases {
                let candidates = installed.iter().map(|dir| runtime(dir)).collect();
                assert_eq!(
                    best_runtime(candidates),
                    Some(runtime(expected)),
                    "installed: {installed:?}"
                );
            }
        }

        #[test]
        fn version_parsing_handles_bare_and_suffixed_names() {
            assert_eq!(parse_proton_version("Proton 9.0 (Beta)"), (9, 0));
            assert_eq!(parse_proton_version("Proton 5.13"), (5, 13));
            assert_eq!(parse_proton_version("Proton Hotfix"), (0, 0));
        }
    }
}
