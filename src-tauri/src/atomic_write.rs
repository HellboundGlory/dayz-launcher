//! Durable atomic file writes: temp file + fsync + rename + best-effort
//! directory fsync, so an unclean shutdown can't leave a settings file
//! half-written or reverted to stale bytes.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

/// Write `contents` to `path` durably: temp file, fsync, rename, then fsync
/// the directory. The temp name is fixed (`.json.tmp`) so a leftover from a
/// previous crash gets overwritten rather than accumulating.
pub fn write_atomically(path: &Path, contents: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = File::create(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    // Best-effort: not every platform (notably Windows) allows opening a directory as a File.
    if let Some(dir) = path.parent() {
        if let Ok(dir_file) = File::open(dir) {
            let _ = dir_file.sync_all();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A fresh scratch directory per test, so parallel test runs never share
    /// one and race each other's temp files.
    fn scratch_dir() -> std::path::PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let id = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("tetra-atomic-write-test-{id}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_and_reads_back_the_content() {
        let path = scratch_dir().join("settings.json");
        write_atomically(&path, b"hello").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn overwrites_existing_content_rather_than_appending() {
        let path = scratch_dir().join("settings.json");
        write_atomically(&path, b"first").unwrap();
        write_atomically(&path, b"second, shorter").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second, shorter");
    }

    #[test]
    fn no_temp_file_survives_a_successful_write() {
        let path = scratch_dir().join("settings.json");
        write_atomically(&path, b"hello").unwrap();
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn a_leftover_temp_file_from_a_previous_crash_is_overwritten_not_accumulated() {
        let path = scratch_dir().join("settings.json");
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, b"stale, from a run that never got to rename").unwrap();

        write_atomically(&path, b"fresh").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "fresh");
        assert!(!tmp.exists());
    }
}
