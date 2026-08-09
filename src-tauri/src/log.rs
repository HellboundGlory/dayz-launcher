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

use std::path::PathBuf;
use tauri::AppHandle;

/// The log file: `<data root>/tetra-launcher.log`, beside the registry.
pub fn path(app: &AppHandle) -> PathBuf {
    crate::paths::data_root(app).join("tetra-launcher.log")
}

/// Append one timestamped line. Best-effort and never panics.
///
/// Called from hot paths (every reload, every discovery update), so a logging
/// failure must not slow or break the launch it is describing.
pub fn log_line(app: &AppHandle, level: &str, msg: &str) {
    eprintln!("[{level}] {msg}");
    let line = format!("[{}] [{level}] {msg}\n", stamp());
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path(app))
    {
        use std::io::Write;
        if file.write_all(line.as_bytes()).is_ok() {
            let _ = file.flush();
        }
    }
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
