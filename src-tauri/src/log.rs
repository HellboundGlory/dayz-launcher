//! Minimal file logger for release diagnostics: appends timestamped lines to
//! `<data root>/tetra-launcher.log`, since a windowed build has no visible
//! stderr and no tracing subscriber. Deliberately dependency-free.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The log file: `<data root>/tetra-launcher.log`, beside the registry.
pub fn path(app: &AppHandle) -> PathBuf {
    crate::paths::data_root(app).join("tetra-launcher.log")
}

/// Log file size cap, checked on the write that crosses it.
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

/// Bytes kept on rotation — half the cap, so rotation isn't immediately repeated.
const KEEP_LOG_BYTES: u64 = MAX_LOG_BYTES / 2;

/// Append one timestamped line. Best-effort and never panics.
pub fn log_line(app: &AppHandle, level: &str, msg: &str) {
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
    if slot.is_none() {
        *slot = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path(app))
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
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false);
    if oversized {
        // Drop the handle before rotating so a stale append handle doesn't
        // keep writing past the truncation point.
        *slot = None;
        drop(slot);
        rotate(app);
    }
}

/// Keep only the newest [`KEEP_LOG_BYTES`], dropping the partial line at the
/// start of the kept tail. Best-effort.
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
