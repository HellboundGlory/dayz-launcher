use crate::error::GateError;
use std::path::PathBuf;
use std::process::{Command, ExitStatus};

/// Spawn DayZ with the given launch arguments.
///
/// # Safety
///
/// This function spawns a child process. It never passes arguments through
/// `cmd.exe` or any shell — `std::process::Command` calls `CreateProcess`
/// directly on Windows.
///
/// # Game executable
///
/// When BattlEye is required, `DayZ_BE.exe` is used. Otherwise
/// `DayZ_x64.exe` is the standard binary.
pub fn spawn_dayz(
    exe_path: &std::path::Path,
    args: &[String],
) -> Result<ExitStatus, GateError> {
    let mut cmd = Command::new(exe_path);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.spawn()
        .map_err(GateError::Launch)?
        .wait()
        .map_err(GateError::Launch)
}

/// Start the Steam client and return immediately.
///
/// Unlike [`spawn_dayz`] this never waits on the child. Steam's first process
/// stays alive for the whole session, so waiting would block the caller until
/// the user quit Steam. Dropping the `Child` does not terminate it on Windows.
pub fn spawn_steam(exe_path: &std::path::Path) -> Result<(), GateError> {
    Command::new(exe_path)
        .spawn()
        .map(|_child| ())
        .map_err(GateError::Launch)
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
}