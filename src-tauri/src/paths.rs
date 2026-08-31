//! Where the launcher keeps its data, and how it got there.
//!
//! Everything the launcher persists (the registry and `settings.json`) lives
//! in one directory, resolved only through [`data_root`].
//!
//! | Mode | Root |
//! |---|---|
//! | Portable | the directory holding the exe |
//! | Installed | `app_local_data_dir()` — `%LOCALAPPDATA%\com.tetra.launcher` |
//!
//! Portable mode is opted into by a marker file, never inferred from exe
//! location — see .ai-notes/src-tauri/src/paths.rs.md for why.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

/// Drop a file with this name beside `tetra-launcher.exe` to make that copy
/// portable. Contents are ignored — only its presence matters.
pub const PORTABLE_MARKER: &str = "portable.txt";

/// The registry and its SQLite sidecars, which only make sense as a set —
/// see [`migrate`] for why all three move together.
const REGISTRY_FILES: &[&str] = &["tetra.db", "tetra.db-wal", "tetra.db-shm"];

/// Written by the retired `tauri-plugin-window-state`; carried across by
/// [`migrate`] so `settings::load_at_startup` can fold it in and delete it.
pub const LEGACY_WINDOW_STATE: &str = ".window-state.json";

struct Root {
    dir: PathBuf,
    portable: bool,
}

/// Resolved once per process — the portable check touches disk.
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

/// The exe's directory, if marked portable *and* actually writable (falls
/// back to app data otherwise — a portable zip can end up somewhere read-only).
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

/// `%LOCALAPPDATA%\com.tetra.launcher`. Local rather than Roaming, since the
/// registry cache reaches 20 MB in ordinary use; Roaming is only a fallback.
fn installed_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Whether a directory accepts a file, answered by writing one rather than
/// inferring from permissions.
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
    /// Files left behind because the destination already had its own copy — destination always wins.
    pub skipped: Vec<String>,
}

impl Migration {
    pub fn is_empty(&self) -> bool {
        self.moved.is_empty() && self.skipped.is_empty()
    }
}

/// Move an older layout's files into `dest`, from the pre-1.3
/// `%APPDATA%\com.tetra.launcher` location. A portable copy never migrates —
/// it would move the installed launcher's database into the unpacked zip's folder.
pub fn migrate_from_legacy(app: &AppHandle, dest: &Path) -> Migration {
    if is_portable(app) {
        return Migration::default();
    }
    let Ok(legacy) = app.path().app_data_dir() else {
        return Migration::default();
    };
    migrate(&legacy, dest)
}

/// Move `legacy`'s data files into `dest`. Idempotent. Copies first and
/// deletes only after every copy succeeded — the registry's 3 files must
/// travel together, or a partial move can leave an uncheckpointed database.
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

    // Independent single files, not part of the registry set.
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

/// Copy every named file, or leave the destination as it was found — a
/// partial copy is cleaned up so the next migration doesn't think the set arrived.
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

    /// A scratch directory unique to one test (no `tempfile` dependency).
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
