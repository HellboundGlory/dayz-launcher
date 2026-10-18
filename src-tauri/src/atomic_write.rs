//! Durable atomic file writes: temp file + fsync + rename + best-effort
//! directory fsync, so an unclean shutdown can't leave a settings file
//! half-written or reverted to stale bytes.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The temp file for an atomic write: the target's file name plus `.tmp`.
fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Write `contents` to `path` durably: temp file, fsync, rename, then fsync
/// the directory. The temp name is [`temp_path`] — the target's own name plus
/// `.tmp`.
pub fn write_atomically(path: &Path, contents: &[u8]) -> io::Result<()> {
    let tmp = temp_path(path);
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
pub(crate) mod test_support {
    use std::ops::Deref;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A per-test scratch directory that deletes itself on drop.
    pub(crate) struct ScratchDir(PathBuf);

    impl ScratchDir {
        pub(crate) fn new() -> Self {
            Self::tagged("test")
        }

        /// A fresh directory under the temp root, named after `tag`.
        pub(crate) fn tagged(tag: &str) -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!("tetra-{tag}-{nanos}-{seq}"));
            std::fs::create_dir_all(&dir).expect("could not create scratch dir");
            Self(dir)
        }
    }

    impl Deref for ScratchDir {
        type Target = Path;

        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl AsRef<Path> for ScratchDir {
        fn as_ref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::ScratchDir;
    use super::*;

    #[test]
    fn two_files_sharing_one_stem_get_different_temp_paths() {
        let dir = ScratchDir::new();
        assert_ne!(
            temp_path(&dir.join("styles.css")),
            temp_path(&dir.join("styles.json"))
        );
        assert_eq!(
            temp_path(&dir.join("styles.css")),
            dir.join("styles.css.tmp")
        );
    }

    #[test]
    fn writes_and_reads_back_the_content() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        write_atomically(&path, b"hello").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn overwrites_existing_content_rather_than_appending() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        write_atomically(&path, b"first").unwrap();
        write_atomically(&path, b"second, shorter").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second, shorter");
    }

    #[test]
    fn no_temp_file_survives_a_successful_write() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        write_atomically(&path, b"hello").unwrap();
        assert!(!temp_path(&path).exists());
    }

    #[test]
    fn a_leftover_temp_file_from_a_previous_crash_is_overwritten_not_accumulated() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        let tmp = temp_path(&path);
        fs::write(&tmp, b"stale, from a run that never got to rename").unwrap();

        write_atomically(&path, b"fresh").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "fresh");
        assert!(!tmp.exists());
    }
}
