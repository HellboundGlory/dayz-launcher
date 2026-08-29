//! Durable atomic file writes: temp file + fsync + rename + best-effort
//! directory fsync (L14, 2026-08-29 audit).
//!
//! Every persisted-settings write in this app already did temp-file +
//! rename, which is atomic — the rename either lands or it doesn't, so a
//! reader never sees a half-written file. What none of them did is
//! *durable*: without an `fsync` on the temp file before the rename, the OS
//! is free to reorder the rename ahead of the data actually reaching disk,
//! so an unclean shutdown (a crash, a power loss) can leave the rename
//! landed with old or garbage bytes behind it. Small in isolation, but this
//! is the file holding every user preference.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

/// Write `contents` to `path` durably: a temp file beside it, fsynced,
/// renamed over `path`, then the containing directory fsynced so the rename
/// itself survives an unclean shutdown.
///
/// The temp file is named `path.with_extension("json.tmp")` — every caller
/// here writes `.json` — rather than something random, so a leftover temp
/// file from a previous crash is simply overwritten next time instead of
/// accumulating forever.
pub fn write_atomically(path: &Path, contents: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = File::create(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    // Best-effort: not every platform lets a directory be opened as a
    // `File` (notably Windows), and the rename above is already atomic
    // without this — it only closes the narrower "the rename landed but the
    // directory entry pointing at it didn't survive a crash" gap.
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
