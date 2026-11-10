//! "Add to app menu": move the running AppImage into `~/Applications`, write a
//! desktop entry and its icon, then reopen from there. Linux only; elsewhere
//! the commands report that the feature is not available.
//!
//! Nothing from the WebView picks a path — the source is the AppImage this
//! process runs from, and every destination is fixed here.

#[cfg(target_os = "linux")]
pub use linux::wait_for_previous_process;

/// What `app_menu_status` reports to the frontend.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct AppMenuStatus {
    pub available: bool,
    pub installed: bool,
}

/// Report whether this copy can offer the menu entry, and whether it already has one.
#[tauri::command]
pub fn app_menu_status(app: tauri::AppHandle) -> AppMenuStatus {
    #[cfg(target_os = "linux")]
    {
        linux::status(&app)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        AppMenuStatus {
            available: false,
            installed: false,
        }
    }
}

/// Move this AppImage into `~/Applications`, add the menu entry with its icon,
/// and reopen from there. Nothing from the WebView picks a path.
#[tauri::command]
pub fn add_to_app_menu(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        linux::install(&app).map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("Adding to the app menu needs the Linux AppImage build.".to_string())
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::ffi::OsString;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Manager;
    use tetra_launch::protocol::desktop_exec_quote;

    /// Where the moved AppImage lives.
    const APPS_DIR_NAME: &str = "Applications";

    /// The desktop file's name inside `<data home>/applications`.
    const DESKTOP_FILE_NAME: &str = "tetra-launcher.desktop";

    /// The icon inside `<data home>/icons/hicolor/128x128/apps`.
    const ICON_FILE_NAME: &str = "tetra-launcher.png";

    const ICON: &[u8] = include_bytes!("../icons/128x128.png");

    /// The argument that makes a reopened copy wait for this one to exit
    /// before it takes the single-instance D-Bus name.
    const WAIT_PID_FLAG: &str = "--wait-pid";

    /// How long a reopened copy waits for its predecessor before giving up.
    const WAIT_PID_LIMIT: std::time::Duration = std::time::Duration::from_secs(10);
    const WAIT_PID_STEP: std::time::Duration = std::time::Duration::from_millis(100);

    #[derive(Debug)]
    pub(super) enum AppMenuError {
        /// Something that is not a plain file already sits at the destination.
        Occupied(PathBuf),
        Io(String),
        /// The AppImage's path cannot be written into an Exec line at all.
        Unquotable(PathBuf),
    }

    impl std::fmt::Display for AppMenuError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                Self::Occupied(path) => write!(
                    f,
                    "{} is in the way. Move or delete it, then try again.",
                    path.display()
                ),
                Self::Io(message) => f.write_str(message),
                Self::Unquotable(path) => write!(
                    f,
                    "{} has a path that cannot go in a menu entry.",
                    path.display()
                ),
            }
        }
    }

    impl std::error::Error for AppMenuError {}

    impl From<io::Error> for AppMenuError {
        fn from(error: io::Error) -> Self {
            Self::Io(error.to_string())
        }
    }

    pub(super) fn desktop_entry(exec: &str) -> String {
        format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=Tetra Launcher\n\
             Comment=Browse and join DayZ servers\n\
             Exec={exec} %u\n\
             Icon=tetra-launcher\n\
             Terminal=false\n\
             Categories=Game;\n\
             MimeType=x-scheme-handler/dzsa;\n"
        )
    }

    /// Whether a desktop file's `Exec` line names this launcher.
    pub(super) fn desktop_entry_names(entry: &str, exec: &str) -> bool {
        entry.lines().any(|line| line == format!("Exec={exec} %u"))
    }

    /// `$XDG_DATA_HOME` when it is set to an absolute path, else `$HOME/.local/share`.
    pub(super) fn data_home(env: impl Fn(&str) -> Option<OsString>) -> PathBuf {
        if let Some(dir) = env("XDG_DATA_HOME").map(PathBuf::from) {
            if dir.is_absolute() {
                return dir;
            }
        }
        let home = env("HOME").map(PathBuf::from).unwrap_or_default();
        home.join(".local").join("share")
    }

    /// Move `src` into `dest_dir`, keeping its file name. A copy already there
    /// is returned as it is; a regular file there is replaced; anything else —
    /// a folder, or a symlink whose target must never be touched — is refused.
    pub(super) fn move_appimage(src: &Path, dest_dir: &Path) -> Result<PathBuf, AppMenuError> {
        let name = src
            .file_name()
            .ok_or_else(|| AppMenuError::Io(format!("{} names no file", src.display())))?;
        let dest = dest_dir.join(name);

        if dest == src {
            return Ok(dest);
        }
        match std::fs::symlink_metadata(&dest) {
            Ok(metadata) if metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(AppMenuError::Occupied(dest));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        match std::fs::rename(src, &dest) {
            Ok(()) => return Ok(dest),
            // A rename cannot cross file systems; copy across instead. Anything
            // else — a missing source, a full disk — is the real failure.
            Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {}
            Err(error) => {
                return Err(AppMenuError::Io(format!(
                    "Could not move {} to {}: {error}",
                    src.display(),
                    dest.display()
                )))
            }
        }

        copy_across(src, &dest)?;
        // The old copy is gone from the user's point of view either way, so a
        // leftover is only worth a log line.
        if let Err(error) = std::fs::remove_file(src) {
            crate::log::line(
                "app-menu",
                &format!(
                    "Could not remove {} after copying it: {error}",
                    src.display()
                ),
            );
        }
        Ok(dest)
    }

    pub(super) fn copy_across(src: &Path, dest: &Path) -> Result<(), AppMenuError> {
        let mut temp_name = dest
            .file_name()
            .map(|name| name.to_os_string())
            .unwrap_or_default();
        temp_name.push(".tmp");
        let temp = dest.with_file_name(temp_name);

        // A leftover temp from an earlier try may be a symlink; removing the
        // link never touches its target, and create_new refuses to follow one.
        match std::fs::remove_file(&temp) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error.into()),
            _ => {}
        }
        let written = (|| -> io::Result<()> {
            let mut from = std::fs::File::open(src)?;
            let mut to = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            io::copy(&mut from, &mut to)?;
            use std::os::unix::fs::PermissionsExt;
            to.set_permissions(std::fs::Permissions::from_mode(0o755))?;
            // Durable before the rename: a crash must not leave a truncated
            // AppImage under the real name.
            to.sync_all()?;
            std::fs::rename(&temp, dest)
        })();
        if let Err(error) = written {
            let _ = std::fs::remove_file(&temp);
            return Err(error.into());
        }
        if let Some(dir) = dest.parent() {
            if let Ok(dir_file) = std::fs::File::open(dir) {
                let _ = dir_file.sync_all();
            }
        }
        Ok(())
    }

    /// The process id a `--wait-pid` argument names, if it holds one. Zero is
    /// not a process to wait for.
    pub(super) fn wait_pid_from_args(argv: &[String]) -> Option<u32> {
        let flag = argv.iter().position(|arg| arg == WAIT_PID_FLAG)?;
        argv.get(flag + 1)?.parse().ok().filter(|pid| *pid != 0)
    }

    /// Hold off until the process named on this command line is gone, so the
    /// single-instance D-Bus name is free by the time this copy takes it.
    pub fn wait_for_previous_process(argv: &[String]) {
        let Some(pid) = wait_pid_from_args(argv) else {
            return;
        };
        let proc_dir = PathBuf::from(format!("/proc/{pid}"));
        let started = std::time::Instant::now();
        while proc_dir.exists() && started.elapsed() < WAIT_PID_LIMIT {
            std::thread::sleep(WAIT_PID_STEP);
        }
        if proc_dir.exists() {
            crate::log::line(
                "app-menu",
                &format!(
                    "process {pid} is still running after {}s; starting anyway",
                    WAIT_PID_LIMIT.as_secs()
                ),
            );
        }
    }

    fn appimage_path(app: &tauri::AppHandle) -> Option<PathBuf> {
        app.env().appimage.map(PathBuf::from)
    }

    /// This process's environment, in the shape [`data_home`] reads.
    fn env_var(name: &str) -> Option<OsString> {
        std::env::var_os(name)
    }

    fn desktop_file(data_home: &Path) -> PathBuf {
        data_home.join("applications").join(DESKTOP_FILE_NAME)
    }

    /// `$HOME/Applications`, or `None` without an absolute `$HOME`.
    pub(super) fn apps_dir_from(env: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
        let home = PathBuf::from(env("HOME")?);
        home.is_absolute().then(|| home.join(APPS_DIR_NAME))
    }

    pub(super) fn status(app: &tauri::AppHandle) -> super::AppMenuStatus {
        status_for(appimage_path(app).as_deref(), &data_home(env_var))
    }

    /// The status for one AppImage path and data home, so the entry matching can
    /// be checked against a scratch directory.
    pub(super) fn status_for(appimage: Option<&Path>, data_home: &Path) -> super::AppMenuStatus {
        let Some(appimage) = appimage else {
            return super::AppMenuStatus {
                available: false,
                installed: false,
            };
        };
        let installed = desktop_exec_quote(appimage)
            .and_then(|exec| {
                let entry = std::fs::read_to_string(desktop_file(data_home)).ok()?;
                Some(desktop_entry_names(&entry, &exec))
            })
            .unwrap_or(false);
        super::AppMenuStatus {
            available: true,
            installed,
        }
    }

    /// Held while an install runs, so a second click cannot race the first.
    static INSTALLING: AtomicBool = AtomicBool::new(false);

    pub(super) fn install(app: &tauri::AppHandle) -> Result<(), AppMenuError> {
        let appimage = appimage_path(app).ok_or_else(|| {
            AppMenuError::Io("This copy is not running as an AppImage.".to_string())
        })?;
        let dest_dir = apps_dir_from(env_var).ok_or_else(|| {
            AppMenuError::Io("HOME is not set to an absolute folder.".to_string())
        })?;
        if INSTALLING.swap(true, Ordering::SeqCst) {
            return Err(AppMenuError::Io(
                "Already adding Tetra to the app menu.".to_string(),
            ));
        }
        let data_home = data_home(env_var);
        let result = install_into(&appimage, &dest_dir, &data_home, |moved| {
            refresh_desktop_database(&data_home.join("applications"));
            reopen(moved)
        });
        match result {
            Ok(moved) => {
                crate::log::line("app-menu", &format!("reopened {}", moved.display()));
                app.exit(0);
                Ok(())
            }
            Err(error) => {
                INSTALLING.store(false, Ordering::SeqCst);
                Err(error)
            }
        }
    }

    /// Everything that can fail is checked or written before the move, and a
    /// failure after it puts the AppImage back where it was.
    pub(super) fn install_into(
        appimage: &Path,
        dest_dir: &Path,
        data_home: &Path,
        reopen: impl FnOnce(&Path) -> Result<(), AppMenuError>,
    ) -> Result<PathBuf, AppMenuError> {
        let name = appimage
            .file_name()
            .ok_or_else(|| AppMenuError::Io(format!("{} names no file", appimage.display())))?;
        let target = dest_dir.join(name);
        let exec = desktop_exec_quote(&target).ok_or(AppMenuError::Unquotable(target.clone()))?;
        write_icon(data_home)?;
        let entry_path = desktop_file(data_home);
        if let Some(parent) = entry_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::create_dir_all(dest_dir)?;

        let moved = move_appimage(appimage, dest_dir)?;
        let finished =
            crate::atomic_write::write_atomically(&entry_path, desktop_entry(&exec).as_bytes())
                .map_err(AppMenuError::from)
                .and_then(|()| reopen(&moved));
        if let Err(error) = finished {
            let _ = std::fs::remove_file(&entry_path);
            if moved != appimage {
                if let Err(back) = move_appimage(&moved, appimage.parent().unwrap_or(dest_dir)) {
                    crate::log::line(
                        "app-menu",
                        &format!("Could not move {} back: {back}", moved.display()),
                    );
                }
            }
            return Err(error);
        }
        Ok(moved)
    }

    fn write_icon(data_home: &Path) -> Result<(), AppMenuError> {
        let dir = data_home
            .join("icons")
            .join("hicolor")
            .join("128x128")
            .join("apps");
        std::fs::create_dir_all(&dir)?;
        crate::atomic_write::write_atomically(&dir.join(ICON_FILE_NAME), ICON)?;
        Ok(())
    }

    /// Ask the desktop to pick up the new entry. The tool is not on every
    /// system, so it being missing is fine.
    fn refresh_desktop_database(apps_dir: &Path) {
        let mut command = std::process::Command::new("update-desktop-database");
        command.arg(apps_dir);
        tetra_launch::spawn::without_appimage_env(&mut command);
        match command.status() {
            Ok(status) if !status.success() => crate::log::line(
                "app-menu",
                &format!("update-desktop-database exited with {status}"),
            ),
            Ok(_) => {}
            Err(error) => crate::log::line(
                "app-menu",
                &format!("update-desktop-database is unavailable ({error})"),
            ),
        }
    }

    /// Start the moved copy in its own process group, so closing a terminal
    /// this copy was started from does not take it down. It waits for this
    /// process to end before taking over.
    fn reopen(path: &Path) -> Result<(), AppMenuError> {
        use std::os::unix::process::CommandExt;
        let mut command = std::process::Command::new(path);
        command
            .arg(WAIT_PID_FLAG)
            .arg(std::process::id().to_string())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0);
        tetra_launch::spawn::without_appimage_env(&mut command);
        command.spawn().map_err(|error| {
            AppMenuError::Io(format!("Could not start {}: {error}", path.display()))
        })?;
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::linux::{
        apps_dir_from, copy_across, data_home, desktop_entry, desktop_entry_names, install_into,
        move_appimage, status_for, wait_pid_from_args, AppMenuError,
    };
    use crate::atomic_write::test_support::ScratchDir;
    use std::ffi::OsString;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use tetra_launch::protocol::desktop_exec_quote;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let pairs: Vec<(String, OsString)> = pairs
            .iter()
            .map(|(name, value)| (name.to_string(), OsString::from(value)))
            .collect();
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        }
    }

    #[test]
    fn desktop_entry_names_the_exec_and_the_scheme() {
        let entry = desktop_entry("\"/home/tetra/Tetra.AppImage\"");
        for line in [
            "[Desktop Entry]",
            "Type=Application",
            "Name=Tetra Launcher",
            "Comment=Browse and join DayZ servers",
            "Exec=\"/home/tetra/Tetra.AppImage\" %u",
            "Icon=tetra-launcher",
            "Terminal=false",
            "Categories=Game;",
            "MimeType=x-scheme-handler/dzsa;",
        ] {
            assert!(entry.contains(&format!("{line}\n")), "missing line: {line}");
        }
    }

    #[test]
    fn data_home_ignores_a_relative_xdg_data_home() {
        assert_eq!(
            data_home(env(&[
                ("XDG_DATA_HOME", "/srv/data"),
                ("HOME", "/home/tetra")
            ])),
            Path::new("/srv/data")
        );
        assert_eq!(
            data_home(env(&[
                ("XDG_DATA_HOME", "relative/data"),
                ("HOME", "/home/tetra")
            ])),
            Path::new("/home/tetra/.local/share")
        );
        assert_eq!(
            data_home(env(&[("HOME", "/home/tetra")])),
            Path::new("/home/tetra/.local/share")
        );
    }

    #[test]
    fn a_desktop_entry_is_matched_by_its_own_exec_line() {
        let entry = desktop_entry("\"/home/tetra/Applications/Tetra.AppImage\"");
        assert!(desktop_entry_names(
            &entry,
            "\"/home/tetra/Applications/Tetra.AppImage\""
        ));
        assert!(!desktop_entry_names(
            &entry,
            "\"/home/tetra/Old/Tetra.AppImage\""
        ));
    }

    #[test]
    fn move_appimage_leaves_a_copy_already_in_place_alone() {
        let dir = ScratchDir::new();
        let src = dir.join("Tetra.AppImage");
        fs::write(&src, b"appimage").unwrap();

        assert_eq!(move_appimage(&src, &dir).unwrap(), src);
        assert_eq!(fs::read(&src).unwrap(), b"appimage");
    }

    #[test]
    fn move_appimage_keeps_the_file_name_and_replaces_a_regular_file() {
        let dir = ScratchDir::new();
        let src = dir.join("Downloads").join("Tetra.AppImage");
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, b"new").unwrap();
        let dest_dir = dir.join("Applications");
        fs::create_dir_all(&dest_dir).unwrap();
        let existing = dest_dir.join("Tetra.AppImage");
        fs::write(&existing, b"old").unwrap();
        // A real AppImage is executable; a rename keeps that.
        fs::set_permissions(&src, fs::Permissions::from_mode(0o755)).unwrap();

        let moved = move_appimage(&src, &dest_dir).unwrap();

        assert_eq!(moved, existing);
        assert_eq!(fs::read(&moved).unwrap(), b"new");
        assert_eq!(
            fs::metadata(&moved).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert!(!src.exists());
    }

    #[test]
    fn copying_across_lands_executable_and_leaves_no_temp_behind() {
        let dir = ScratchDir::new();
        let src = dir.join("Tetra.AppImage");
        fs::write(&src, b"appimage").unwrap();
        let dest_dir = dir.join("Applications");
        fs::create_dir_all(&dest_dir).unwrap();
        let dest = dest_dir.join("Tetra.AppImage");

        copy_across(&src, &dest).unwrap();

        assert_eq!(fs::read(&dest).unwrap(), b"appimage");
        assert_eq!(
            fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert_eq!(fs::read_dir(&dest_dir).unwrap().count(), 1);
    }

    #[test]
    fn copying_across_replaces_a_stale_temp_symlink_without_touching_its_target() {
        let dir = ScratchDir::new();
        let src = dir.join("Tetra.AppImage");
        fs::write(&src, b"appimage").unwrap();
        let target = dir.join("elsewhere");
        fs::write(&target, b"untouched").unwrap();
        let dest_dir = dir.join("Applications");
        fs::create_dir_all(&dest_dir).unwrap();
        std::os::unix::fs::symlink(&target, dest_dir.join("Tetra.AppImage.tmp")).unwrap();
        let dest = dest_dir.join("Tetra.AppImage");

        copy_across(&src, &dest).unwrap();

        assert_eq!(fs::read(&dest).unwrap(), b"appimage");
        assert_eq!(fs::read(&target).unwrap(), b"untouched");
        assert!(!dest_dir.join("Tetra.AppImage.tmp").exists());
    }

    #[test]
    fn a_failed_reopen_puts_the_appimage_back_and_drops_the_entry() {
        let dir = ScratchDir::new();
        let src = dir.join("Downloads").join("Tetra.AppImage");
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, b"appimage").unwrap();
        let dest_dir = dir.join("Applications");
        let data_home = dir.join("share");

        let error = install_into(&src, &dest_dir, &data_home, |_| {
            Err(AppMenuError::Io("no exec".into()))
        })
        .unwrap_err();

        assert!(error.to_string().contains("no exec"), "{error}");
        assert_eq!(fs::read(&src).unwrap(), b"appimage");
        assert!(!dest_dir.join("Tetra.AppImage").exists());
        assert!(!data_home
            .join("applications")
            .join("tetra-launcher.desktop")
            .exists());
    }

    #[test]
    fn install_writes_the_entry_for_the_moved_copy_then_reopens_it() {
        let dir = ScratchDir::new();
        let src = dir.join("Downloads").join("Tetra.AppImage");
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, b"appimage").unwrap();
        let dest_dir = dir.join("Applications");
        let data_home = dir.join("share");
        let mut reopened = None;

        install_into(&src, &dest_dir, &data_home, |path| {
            reopened = Some(path.to_path_buf());
            Ok(())
        })
        .unwrap();

        let moved = dest_dir.join("Tetra.AppImage");
        assert_eq!(reopened.as_deref(), Some(moved.as_path()));
        assert!(status_for(Some(&moved), &data_home).installed);
        assert!(data_home
            .join("icons/hicolor/128x128/apps/tetra-launcher.png")
            .exists());
    }

    #[test]
    fn a_path_no_entry_can_carry_is_refused_before_anything_moves() {
        let dir = ScratchDir::new();
        let src = dir.join("Tetra\nBeta.AppImage");
        fs::write(&src, b"appimage").unwrap();
        let dest_dir = dir.join("Applications");

        let error = install_into(&src, &dest_dir, &dir.join("share"), |_| Ok(())).unwrap_err();

        assert!(matches!(error, AppMenuError::Unquotable(_)), "{error:?}");
        assert!(src.exists());
        assert!(!dest_dir.exists());
    }

    #[test]
    fn applications_needs_an_absolute_home() {
        assert_eq!(
            apps_dir_from(env(&[("HOME", "/home/tetra")])).as_deref(),
            Some(Path::new("/home/tetra/Applications"))
        );
        assert_eq!(apps_dir_from(env(&[("HOME", "tetra")])), None);
        assert_eq!(apps_dir_from(env(&[])), None);
    }

    #[test]
    fn move_appimage_refuses_a_folder_at_the_destination() {
        let dir = ScratchDir::new();
        let src = dir.join("Tetra.AppImage");
        fs::write(&src, b"appimage").unwrap();
        let dest_dir = dir.join("Applications");
        fs::create_dir_all(dest_dir.join("Tetra.AppImage")).unwrap();

        let error = move_appimage(&src, &dest_dir).unwrap_err();

        assert!(matches!(error, AppMenuError::Occupied(_)), "{error:?}");
        assert!(error.to_string().contains("Tetra.AppImage"), "{error}");
        assert!(src.exists());
    }

    #[test]
    fn move_appimage_never_follows_a_symlink_at_the_destination() {
        let dir = ScratchDir::new();
        let src = dir.join("Tetra.AppImage");
        fs::write(&src, b"appimage").unwrap();
        let target = dir.join("elsewhere");
        fs::write(&target, b"untouched").unwrap();
        let dest_dir = dir.join("Applications");
        fs::create_dir_all(&dest_dir).unwrap();
        std::os::unix::fs::symlink(&target, dest_dir.join("Tetra.AppImage")).unwrap();

        let error = move_appimage(&src, &dest_dir).unwrap_err();

        assert!(matches!(error, AppMenuError::Occupied(_)), "{error:?}");
        assert_eq!(fs::read(&target).unwrap(), b"untouched");
    }

    #[test]
    fn status_is_installed_only_when_the_entry_names_this_copy() {
        let dir = ScratchDir::new();
        let data_home = dir.join("share");
        fs::create_dir_all(data_home.join("applications")).unwrap();
        let ours = dir.join("Applications/Tetra.AppImage");
        let other = dir.join("Downloads/Tetra.AppImage");

        // No AppImage at all: nothing to offer.
        assert_eq!(
            status_for(None, &data_home),
            super::AppMenuStatus {
                available: false,
                installed: false
            }
        );

        // An AppImage with no entry yet.
        assert_eq!(
            status_for(Some(&ours), &data_home),
            super::AppMenuStatus {
                available: true,
                installed: false
            }
        );

        // An entry naming another copy is not ours.
        let exec = desktop_exec_quote(&other).unwrap();
        fs::write(
            data_home.join("applications/tetra-launcher.desktop"),
            desktop_entry(&exec),
        )
        .unwrap();
        assert!(!status_for(Some(&ours), &data_home).installed);

        let exec = desktop_exec_quote(&ours).unwrap();
        fs::write(
            data_home.join("applications/tetra-launcher.desktop"),
            desktop_entry(&exec),
        )
        .unwrap();
        assert!(status_for(Some(&ours), &data_home).installed);
    }

    #[test]
    fn wait_pid_reads_the_previous_process_id() {
        let cases: &[(&[&str], Option<u32>)] = &[
            (&["tetra-launcher", "--wait-pid", "4242"], Some(4242)),
            (
                &["tetra-launcher", "--autostart", "--wait-pid", "7"],
                Some(7),
            ),
            (&["tetra-launcher"], None),
            // A missing or unusable value waits for nothing rather than forever.
            (&["tetra-launcher", "--wait-pid"], None),
            (&["tetra-launcher", "--wait-pid", "soon"], None),
            (&["tetra-launcher", "--wait-pid", "0"], None),
        ];
        for (args, expected) in cases {
            let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
            assert_eq!(wait_pid_from_args(&args), *expected, "argv: {args:?}");
        }
    }
}
