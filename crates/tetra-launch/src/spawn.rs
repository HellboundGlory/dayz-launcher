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
pub fn spawn_dayz(exe_path: &std::path::Path, args: &[String]) -> Result<(), SpawnError> {
    Command::new(exe_path)
        .args(args)
        .spawn()
        .map(|_child| ())
        .map_err(SpawnError::Launch)
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
/// - `server_ip` — The server to connect to (game port, not query port).
/// - `server_port` — Game port.
/// - `password` — Optional server password.
/// - `mod_arg` — The full `-mod=...` string (or empty for vanilla).
/// - `extra_params` — User-configured launch parameters (e.g. `-noSplash`).
///
/// The mod argument is always last in the list so the user's parameters
/// cannot accidentally truncate or interfere with it.
pub fn build_launch_args(
    server_ip: &str,
    server_port: u16,
    password: Option<&str>,
    mod_arg: &str,
    extra_params: &[String],
    profile_name: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // Server connection
    args.push(format!("-connect={server_ip}"));
    args.push(format!("-port={server_port}"));

    if let Some(pw) = password {
        args.push(format!("-password={pw}"));
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
        let args = build_launch_args("127.0.0.1", 2302, None, "", &[], None);
        assert_eq!(args, vec!["-connect=127.0.0.1", "-port=2302"]);
    }

    #[test]
    fn launch_with_name_and_mods() {
        let args = build_launch_args(
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
        let args = build_launch_args("10.0.0.1", 2302, None, "", &[], None);
        assert!(!args.contains(&String::from("-mod=")));
    }

    #[test]
    fn name_omitted_when_none() {
        let args = build_launch_args("127.0.0.1", 2302, None, "", &[], None);
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
        let args = build_launch_args("127.0.0.1", 2302, None, "", &extra, None);
        for flag in &extra {
            assert!(args.contains(flag), "{flag} was dropped");
        }
    }
}
