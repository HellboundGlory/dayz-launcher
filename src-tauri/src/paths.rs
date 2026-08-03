//! Where the launcher keeps its data, and how it got there.
//!
//! Everything the launcher persists — the registry (`tetra.db` and its two
//! SQLite sidecars) and `settings.json`, which now carries the window geometry
//! too — lives in one directory, resolved here and nowhere else. Both call
//! sites ([`crate::commands::settings::settings_path`] and the registry open in
//! `setup`) go through [`data_root`], so there is exactly one answer to "where
//! is my data" per run.
//!
//! ## The two modes
//!
//! | Mode | Root |
//! |---|---|
//! | Portable | the directory holding the exe |
//! | Installed | `app_local_data_dir()` — `%LOCALAPPDATA%\com.tetra.launcher` |
//!
//! **Portable mode is opted into by a marker file, never inferred from where
//! the exe sits.** That distinction is the whole design. A location heuristic
//! — "not under the install root, therefore portable" — would make every
//! `cargo`/`tauri dev` build write its database next to the binary again, which
//! is precisely the bug the comment in `lib.rs` describes: two databases, one
//! under `target/debug` and one in the repo root, with favourites appearing to
//! vanish depending on how the launcher was started. `is_installed_copy` in
//! `commands::update` answers false for dev builds for exactly that reason, so
//! it is deliberately *not* reused here.
//!
//! Installed copies stay out of the install tree. The NSIS uninstaller removes
//! that tree and the updater re-runs the installer, so a database living beside
//! the exe is a database an update can take with it.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

/// Drop a file with this name beside `tetra-launcher.exe` to make that copy
/// portable. Contents are ignored — only its presence matters.
pub const PORTABLE_MARKER: &str = "portable.txt";

/// The registry and its SQLite sidecars, which only make sense as a set.
///
/// A `tetra.db` separated from its `-wal` loses every transaction that had not
/// been checkpointed, which is why [`migrate`] moves all three or none.
const REGISTRY_FILES: &[&str] = &["tetra.db", "tetra.db-wal", "tetra.db-shm"];

/// Written by the retired `tauri-plugin-window-state`. Carried across by
/// [`migrate`] so `settings::load_at_startup` can fold the geometry in and
/// delete it — see that function.
pub const LEGACY_WINDOW_STATE: &str = ".window-state.json";

/// The chosen directory and how it was chosen. The mode is kept because
/// migration depends on it — see [`migrate_from_legacy`].
struct Root {
    dir: PathBuf,
    portable: bool,
}

/// Resolved once per process. The portable check touches the disk (a marker
/// lookup and a write probe) and `settings_path` is on the settings-read path,
/// so the answer is computed once rather than per call.
static DATA_ROOT: OnceLock<Root> = OnceLock::new();

fn root(app: &AppHandle) -> &'static Root {
    DATA_ROOT.get_or_init(|| resolve(app))
}

/// The one directory the launcher persists into.
pub fn data_root(app: &AppHandle) -> PathBuf {
    root(app).dir.clone()
}

/// Whether this copy carries the portable marker and is storing data beside
/// its exe.
pub fn is_portable(app: &AppHandle) -> bool {
    root(app).portable
}

fn resolve(app: &AppHandle) -> Root {
    match portable_root() {
        Some(dir) => {
            eprintln!("[paths] Portable copy: data in {}", dir.display());
            Root {
                dir,
                portable: true,
            }
        }
        None => Root {
            dir: installed_root(app),
            portable: false,
        },
    }
}

/// The exe's directory, if this copy is marked portable *and* that directory
/// can actually be written to.
///
/// The write probe is not defensive padding: a portable zip is routinely
/// unpacked somewhere read-only — a USB stick with the switch flipped, a
/// network share, `C:\Program Files` because someone dragged it there. Falling
/// back to app data keeps such a copy working with the settings it had, rather
/// than failing to open the registry and silently running in-memory.
fn portable_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    if !dir.join(PORTABLE_MARKER).is_file() {
        return None;
    }
    if !is_writable(dir) {
        eprintln!(
            "[paths] {PORTABLE_MARKER} found in {} but it is not writable; \
             using the per-user data directory instead.",
            dir.display()
        );
        return None;
    }
    Some(dir.to_path_buf())
}

/// `%LOCALAPPDATA%\com.tetra.launcher`.
///
/// Local rather than Roaming, which is where this used to live: the registry
/// is a rebuildable cache of servers that reached 20 MB in ordinary use, and a
/// roaming profile copies its whole contents at every logon. Roaming is kept
/// only as a fallback for a platform where `app_local_data_dir` fails.
fn installed_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Whether a directory accepts a file, answered by writing one.
///
/// Windows permissions do not reduce to a readable bit — an ACL, a read-only
/// volume and a locked removable device all present differently — so the
/// question is settled empirically instead of inferred.
fn is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".tetra-write-probe");
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// What a migration did, for the log line in `setup`.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Migration {
    /// Files moved out of the old location.
    pub moved: Vec<String>,
    /// Files left behind because the destination already had its own copy.
    /// The destination always wins — a half-merge of two databases is worse
    /// than either one of them.
    pub skipped: Vec<String>,
}

impl Migration {
    pub fn is_empty(&self) -> bool {
        self.moved.is_empty() && self.skipped.is_empty()
    }
}

/// Move an older layout's files into `dest`, from the pre-1.3 location.
///
/// Resolves the legacy directory (`%APPDATA%\com.tetra.launcher`, the Roaming
/// one `app_data_dir` returns) and defers to [`migrate`].
///
/// **A portable copy never migrates.** The legacy directory is per-user and
/// shared with whatever is installed on that machine, so a portable copy that
/// adopted it would move the *installed* launcher's database into the folder
/// the zip was unpacked into — emptying a working install because someone tried
/// the portable build once. A portable copy starts empty, which is the whole
/// promise of one.
pub fn migrate_from_legacy(app: &AppHandle, dest: &Path) -> Migration {
    if is_portable(app) {
        return Migration::default();
    }
    let Ok(legacy) = app.path().app_data_dir() else {
        return Migration::default();
    };
    migrate(&legacy, dest)
}

/// Move `legacy`'s data files into `dest`.
///
/// Idempotent, and safe to call on every start: it returns immediately when the
/// two directories are the same, when the source does not exist, or when the
/// files have already been moved.
///
/// **Copy first, delete only after every copy succeeded.** A `rename` would be
/// cheaper, but the registry is three files that have to travel together, and a
/// rename that succeeds for `tetra.db` and then fails for `tetra.db-wal` — a
/// different volume, a permissions difference, a full disk — leaves a database
/// missing its uncheckpointed transactions with no way back. Copying leaves the
/// original untouched until the whole set has landed.
pub fn migrate(legacy: &Path, dest: &Path) -> Migration {
    let mut report = Migration::default();
    if legacy == dest || !legacy.is_dir() {
        return report;
    }
    if std::fs::create_dir_all(dest).is_err() {
        return report;
    }

    // The registry set: all three or none.
    let present: Vec<&str> = REGISTRY_FILES
        .iter()
        .copied()
        .filter(|name| legacy.join(name).is_file())
        .collect();
    if !present.is_empty() {
        if dest.join("tetra.db").exists() {
            report
                .skipped
                .extend(present.iter().map(|name| (*name).to_string()));
        } else if copy_group(legacy, dest, &present) {
            for name in &present {
                let _ = std::fs::remove_file(legacy.join(name));
                report.moved.push((*name).to_string());
            }
        }
    }

    // Independent single files. `settings.json` is not part of the registry
    // set, and the window-state file is carried over only so the geometry can
    // be folded into settings and the file dropped.
    for name in [crate::commands::settings::FILENAME, LEGACY_WINDOW_STATE] {
        let from = legacy.join(name);
        if !from.is_file() {
            continue;
        }
        let to = dest.join(name);
        if to.exists() {
            report.skipped.push(name.to_string());
            continue;
        }
        if std::fs::copy(&from, &to).is_ok() {
            let _ = std::fs::remove_file(&from);
            report.moved.push(name.to_string());
        }
    }

    report
}

/// Copy every named file, or leave the destination as it was found.
///
/// A partial copy is cleaned up rather than left for the next start to trip
/// over: a lone `tetra.db-wal` in the destination would make the *next*
/// migration think the set had already arrived.
fn copy_group(from: &Path, to: &Path, names: &[&str]) -> bool {
    let mut written: Vec<PathBuf> = Vec::new();
    for name in names {
        let target = to.join(name);
        match std::fs::copy(from.join(name), &target) {
            Ok(_) => written.push(target),
            Err(e) => {
                eprintln!("[paths] Could not copy {name} into {}: {e}", to.display());
                for path in &written {
                    let _ = std::fs::remove_file(path);
                }
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory unique to one test. No `tempfile` dependency in this
    /// crate, and a migration test needs real directories — the code under test
    /// is entirely file movement.
    fn scratch(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-paths-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        dir
    }

    fn write(dir: &Path, name: &str, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn the_registry_and_its_sidecars_move_together() {
        let root = scratch("group");
        let (legacy, dest) = (root.join("old"), root.join("new"));
        write(&legacy, "tetra.db", "db");
        write(&legacy, "tetra.db-wal", "wal");
        write(&legacy, "tetra.db-shm", "shm");

        let report = migrate(&legacy, &dest);

        assert_eq!(report.moved.len(), 3);
        for name in REGISTRY_FILES {
            assert!(dest.join(name).is_file(), "{name} should have arrived");
            assert!(!legacy.join(name).exists(), "{name} should have left");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A database at the destination is the live one. Overwriting it with an
    /// older copy from the previous location is silent data loss.
    #[test]
    fn an_existing_destination_database_is_never_overwritten() {
        let root = scratch("nooverwrite");
        let (legacy, dest) = (root.join("old"), root.join("new"));
        write(&legacy, "tetra.db", "old");
        write(&dest, "tetra.db", "current");

        let report = migrate(&legacy, &dest);

        assert_eq!(
            std::fs::read_to_string(dest.join("tetra.db")).unwrap(),
            "current"
        );
        assert!(
            legacy.join("tetra.db").is_file(),
            "the source is left alone"
        );
        assert!(report.moved.is_empty());
        assert_eq!(report.skipped, vec!["tetra.db".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Running twice must not undo the first run or report phantom work.
    #[test]
    fn migrating_twice_is_a_no_op_the_second_time() {
        let root = scratch("idempotent");
        let (legacy, dest) = (root.join("old"), root.join("new"));
        write(&legacy, "tetra.db", "db");
        write(&legacy, "settings.json", "{}");

        let first = migrate(&legacy, &dest);
        let second = migrate(&legacy, &dest);

        assert!(!first.is_empty());
        assert!(second.is_empty(), "nothing left to move: {second:?}");
        assert_eq!(
            std::fs::read_to_string(dest.join("tetra.db")).unwrap(),
            "db"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn settings_and_the_retired_window_state_file_come_across() {
        let root = scratch("singles");
        let (legacy, dest) = (root.join("old"), root.join("new"));
        write(&legacy, "settings.json", r#"{"profileName":"x"}"#);
        write(&legacy, LEGACY_WINDOW_STATE, r#"{"main":{}}"#);

        let report = migrate(&legacy, &dest);

        assert!(dest.join("settings.json").is_file());
        assert!(dest.join(LEGACY_WINDOW_STATE).is_file());
        assert_eq!(report.moved.len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The portable case where the exe directory *is* the old directory, and
    /// the case of a first run with nothing to bring across.
    #[test]
    fn the_same_directory_or_a_missing_source_migrates_nothing() {
        let root = scratch("same");
        write(&root, "tetra.db", "db");

        assert!(migrate(&root, &root).is_empty());
        assert!(migrate(&root.join("absent"), &root.join("new")).is_empty());
        assert!(root.join("tetra.db").is_file(), "nothing was disturbed");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_writable_directory_probes_true_and_leaves_nothing_behind() {
        let root = scratch("probe");
        assert!(is_writable(&root));
        assert_eq!(
            std::fs::read_dir(&root).unwrap().count(),
            0,
            "the probe file must be cleaned up"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
