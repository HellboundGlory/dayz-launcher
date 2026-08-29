//! Minimal file logger for release diagnostics.
//!
//! The launcher has no tracing subscriber wired to disk — `eprintln!` goes to
//! stderr, which a windowed build never shows, and the `tracing::` lines in the
//! crates are dropped for want of a subscriber. So anything worth diagnosing
//! from an installed or double-clicked copy is lost. This appends one
//! timestamped line at a time to `<data root>/tetra-launcher.log`, which is
//! what the splash-70% diagnosis (and any future report) gets read from.
//!
//! Deliberately dependency-free (no chrono/tracing-subscriber): a logger on the
//! hot path of a launcher that is currently misbehaving must not be the thing
//! that changes timing or needs a new crate.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The log file: `<data root>/tetra-launcher.log`, beside the registry.
pub fn path(app: &AppHandle) -> PathBuf {
    crate::paths::data_root(app).join("tetra-launcher.log")
}

/// Hard cap on the log file's size, checked on the write that crosses it —
/// not on every write. Before this the file had no rotation at all and no
/// size cap: a launcher left running for weeks accumulated a log nobody would
/// ever read (M8).
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

/// How much of the file survives a rotation. Half the cap, not the whole
/// thing, so a rotation isn't immediately repeated by the next write.
const KEEP_LOG_BYTES: u64 = MAX_LOG_BYTES / 2;

/// Append one timestamped line. Best-effort and never panics.
///
/// Called from hot paths (every reload, every discovery update), so a logging
/// failure must not slow or break the launch it is describing.
pub fn log_line(app: &AppHandle, level: &str, msg: &str) {
    eprintln!("[{level}] {msg}");
    write_line(app, &format!("[{}] [{level}] {msg}\n", stamp()));
}

/// Same as [`log_line`], but silently dropped unless verbose logging is
/// enabled (debug builds only — see [`verbose_enabled`]).
///
/// For the small set of lines that fire on a genuine hot path (every reload,
/// every server-list load) rather than on a discrete event. The splash-70%
/// investigation that justified logging those at full volume (progress.md)
/// is finished; left at that volume by default, they alone reproduce the
/// unbounded-growth problem the rotation above exists to guard against.
pub fn log_line_verbose(app: &AppHandle, level: &str, msg: &str) {
    if !verbose_enabled() {
        return;
    }
    log_line(app, level, msg);
}

/// Whether [`log_line_verbose`] actually writes. Debug-build-only rather than
/// a settings toggle: the investigation these lines were added for is done,
/// and a debug build is exactly where someone chasing a similar timing bug
/// would flip this back on.
fn verbose_enabled() -> bool {
    cfg!(debug_assertions)
}

/// Write `line` through the persistent handle on `AppState`, opening it on
/// first use and reopening it if a previous write left it in a bad state.
///
/// Kept open across calls rather than opened-appended-closed per line (the
/// previous behaviour): on the hot paths this logs from, that was a file
/// handle open/close pair several times a second for no benefit.
fn write_line(app: &AppHandle, line: &str) {
    let state = app.state::<crate::state::AppState>();
    let Ok(mut slot) = state.log_file.lock() else {
        return;
    };
    if slot.is_none() {
        *slot = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path(app))
            .ok();
    }
    let Some(file) = slot.as_mut() else { return };
    if file.write_all(line.as_bytes()).is_err() {
        // The handle may be broken (e.g. the file was removed out from under
        // us) — drop it so the next call reopens fresh, rather than failing
        // silently forever.
        *slot = None;
        return;
    }
    let _ = file.flush();

    let oversized = file
        .metadata()
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false);
    if oversized {
        // Drop the handle before rotating: the rotation below reopens the
        // path itself, and a stale append handle would otherwise keep
        // writing past the point the file was truncated.
        *slot = None;
        drop(slot);
        rotate(app);
    }
}

/// Keep only the newest [`KEEP_LOG_BYTES`] of the log file, dropping
/// whatever partial line starts the kept tail so the result never opens on a
/// truncated line.
///
/// Best-effort: any failure here just leaves the file to keep growing until
/// the next write crosses the cap again — this must never be the thing that
/// breaks logging.
fn rotate(app: &AppHandle) {
    let p = path(app);
    let Ok(mut file) = std::fs::File::open(&p) else {
        return;
    };
    let Ok(len) = file.metadata().map(|m| m.len()) else {
        return;
    };
    if len <= KEEP_LOG_BYTES {
        return;
    }
    if file.seek(SeekFrom::Start(len - KEEP_LOG_BYTES)).is_err() {
        return;
    }
    let mut tail = Vec::with_capacity(KEEP_LOG_BYTES as usize);
    if file.read_to_end(&mut tail).is_err() {
        return;
    }
    let start = tail
        .iter()
        .position(|&b| b == b'\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    let _ = std::fs::write(&p, &tail[start..]);
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
