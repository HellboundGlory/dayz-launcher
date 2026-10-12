//! Minimal file logger for release diagnostics: appends timestamped lines to
//! `<data root>/tetra-launcher.log`, since a windowed build has no visible
//! stderr and no tracing subscriber. Deliberately dependency-free.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

/// The log file: `<data root>/tetra-launcher.log`, beside the registry.
pub fn path(app: &AppHandle) -> PathBuf {
    crate::paths::data_root(app).join("tetra-launcher.log")
}

/// Log file size cap, checked on the write that crosses it.
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Called first in `setup`; anything logged before it only reaches stderr.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// For code with no `AppHandle` in scope.
pub fn line(level: &str, msg: &str) {
    match APP.get() {
        Some(app) => log_line(app, level, msg),
        None => eprintln!("[{level}] {msg}"),
    }
}

/// Cap on a field's length after sanitising, so no one message can flood the log file.
const MAX_FIELD_LEN: usize = 2000;

/// Strip control characters (so a message can't forge a fake second log line
/// via an embedded newline) and cap the length.
fn sanitise(s: &str) -> String {
    let cleaned: String = s.chars().filter(|c| !c.is_control()).collect();
    match cleaned.char_indices().nth(MAX_FIELD_LEN) {
        Some((byte_idx, _)) => cleaned[..byte_idx].to_string(),
        None => cleaned,
    }
}

/// Append one timestamped line. Best-effort and never panics.
pub fn log_line(app: &AppHandle, level: &str, msg: &str) {
    let (level, msg) = (sanitise(level), sanitise(msg));
    eprintln!("[{level}] {msg}");
    write_line(app, &format!("[{}] [{level}] {msg}\n", stamp()));
}

/// Same as [`log_line`], but only writes in debug builds (see [`verbose_enabled`]).
/// For hot-path lines (every reload, every server-list load).
pub fn log_line_verbose(app: &AppHandle, level: &str, msg: &str) {
    if !verbose_enabled() {
        return;
    }
    log_line(app, level, msg);
}

fn verbose_enabled() -> bool {
    cfg!(debug_assertions)
}

/// Write `line` through the persistent handle on `AppState`, opening it on
/// first use and reopening it if a previous write left it in a bad state.
fn write_line(app: &AppHandle, line: &str) {
    let state = app.state::<crate::state::AppState>();
    let Ok(mut slot) = state.log_file.lock() else {
        return;
    };
    append(&mut slot, &path(app), line, MAX_LOG_BYTES);
}

/// Append `line` through the handle in `slot`, opening it on first use, and
/// rotate in place once the file passes `max_bytes`. The caller holds the lock
/// for the whole call, so no other writer can append mid-rotation.
fn append(slot: &mut Option<std::fs::File>, path: &Path, line: &str, max_bytes: u64) {
    if slot.is_none() {
        *slot = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok();
    }
    let Some(file) = slot.as_mut() else { return };
    if file.write_all(line.as_bytes()).is_err() {
        // Handle may be broken (e.g. file removed) — drop it so the next call reopens fresh.
        *slot = None;
        return;
    }
    let _ = file.flush();

    let oversized = file
        .metadata()
        .map(|m| m.len() > max_bytes)
        .unwrap_or(false);
    if oversized {
        // Drop the handle before rotating so a stale append handle doesn't
        // keep writing past the truncation point.
        *slot = None;
        rotate(path, max_bytes / 2);
    }
}

/// Keep only the newest `keep_bytes`, dropping the partial line at the start of
/// the kept tail. Best-effort.
fn rotate(path: &Path, keep_bytes: u64) {
    let Ok(mut file) = std::fs::File::open(path) else {
        return;
    };
    let Ok(len) = file.metadata().map(|m| m.len()) else {
        return;
    };
    if len <= keep_bytes {
        return;
    }
    if file.seek(SeekFrom::Start(len - keep_bytes)).is_err() {
        return;
    }
    let mut tail = Vec::with_capacity(keep_bytes as usize);
    if file.read_to_end(&mut tail).is_err() {
        return;
    }
    let start = tail
        .iter()
        .position(|&b| b == b'\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    let _ = std::fs::write(path, &tail[start..]);
}

/// Sortable timestamp without a date dependency: `unix-seconds HH:MM:SSZ`.
/// The epoch number makes lines trivial to order, filter and diff.
fn stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let day = secs % 86_400;
    format!(
        "{} {:02}:{:02}:{:02}Z",
        secs,
        day / 3600,
        (day % 3600) / 60,
        day % 60
    )
}

#[cfg(test)]
mod tests {
    use super::{append, sanitise, MAX_FIELD_LEN};
    use std::fs::File;
    use std::sync::Mutex;

    const BODY: &str = "xxxxxxxxxxxxxxxxxxxx";

    #[test]
    fn writers_sharing_the_handle_across_rotation_keep_whole_lines() {
        let dir = std::env::temp_dir().join(format!("tetra-log-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tetra-launcher.log");
        let _ = std::fs::remove_file(&path);
        let slot: Mutex<Option<File>> = Mutex::new(None);
        const CAP: u64 = 1024;

        std::thread::scope(|s| {
            for writer in 0..4 {
                let (slot, path) = (&slot, &path);
                s.spawn(move || {
                    for i in 0..1000 {
                        let line = format!("[{writer}-{i:04}] {BODY}\n");
                        append(&mut slot.lock().unwrap(), path, &line, CAP);
                    }
                });
            }
        });
        append(&mut slot.lock().unwrap(), &path, "final\n", CAP);

        let text = std::fs::read_to_string(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(text.ends_with("final\n"), "{text:?}");
        // Rotation drops only the oldest lines, so each writer's survivors must run on without a gap.
        let mut last: [Option<u32>; 4] = [None; 4];
        for line in text.lines().filter(|line| *line != "final") {
            assert!(
                line.len() == 29 && line.starts_with('[') && line.ends_with(BODY),
                "torn line: {line:?}"
            );
            let writer = (line.as_bytes()[1] - b'0') as usize;
            let seq: u32 = line[3..7].parse().unwrap();
            if let Some(prev) = last[writer] {
                assert_eq!(seq, prev + 1, "writer {writer} lost a line");
            }
            last[writer] = Some(seq);
        }
    }

    /// Stripping control characters stops a message from forging a fake
    /// second log line via an embedded newline.
    #[test]
    fn control_characters_are_stripped_from_a_message() {
        let cases = [
            (
                "real message\n[exit] state persisted and Steam shut down; terminating",
                "real message[exit] state persisted and Steam shut down; terminating",
            ),
            ("a\rb\tc\u{7}d", "abcd"),
            (
                "get_server_list: 42 rows in 12ms",
                "get_server_list: 42 rows in 12ms",
            ),
        ];
        for (raw, expected) in cases {
            assert_eq!(sanitise(raw), expected, "raw: {raw:?}");
        }
    }

    #[test]
    fn a_field_longer_than_the_cap_is_truncated_not_rejected() {
        let long = "a".repeat(MAX_FIELD_LEN + 500);
        let cleaned = sanitise(&long);
        assert_eq!(cleaned.chars().count(), MAX_FIELD_LEN);
    }
}
