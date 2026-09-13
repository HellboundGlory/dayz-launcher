//! Dev Mode hot reload: a filesystem watch on the active theme's directory that
//! tells the frontend to re-read it. Deciding *when* to watch — Dev Mode on, a
//! different theme becoming active — is the frontend's call; this module only
//! starts, replaces and stops the watch it is asked for, and applies nothing
//! itself.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// The event the frontend listens on: one per debounced burst, carrying the id
/// of the theme that changed.
pub const EVENT: &str = "theme-hot-reload";

/// An editor's autosave or format-on-save rewrites the same files several times
/// in a burst, and the frontend re-reads the whole theme either way — so writes
/// are coalesced for this long after the last one before a single event goes out.
const DEBOUNCE: Duration = Duration::from_millis(100);

const POISONED: &str = "The theme watch lock is poisoned";

/// The live watch: the platform watcher, plus the debounce thread reading it.
/// Both are owned here so dropping the watch stops it, which is how a replaced
/// or stopped watch is torn down.
pub struct ThemeWatch {
    pub id: String,
    /// `None` only while [`Drop`] is tearing the watch down.
    watcher: Option<RecommendedWatcher>,
    /// Set before the watcher is dropped, so a debounce window that expires
    /// mid-teardown reports nothing.
    stopped: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for ThemeWatch {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        // Dropping the watcher ends notify's own event thread, which drops the
        // handler holding the sender — the debounce thread sees the channel
        // close and exits, so the join below returns rather than blocking.
        drop(self.watcher.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// What a watch reports to its caller: files under the theme changed, or the
/// watcher stopped delivering events and says why.
enum WatchSignal {
    Changed,
    Failed(String),
}

/// Watch `id`'s directory for changes, replacing whatever was being watched.
/// An id with no directory is a no-op success: this is called on every Dev Mode
/// toggle and active-theme change, so a built-in preset with nothing on disk is
/// ordinary, not an error the frontend has to handle.
pub fn watch(app: &AppHandle, id: &str) -> Result<(), String> {
    let slot = &app.state::<AppState>().theme_watch;
    let themes_root = crate::paths::themes_dir(app);

    let handle = app.clone();
    let watched = id.to_string();
    let started = start(slot, &themes_root, id, move |signal| match signal {
        WatchSignal::Changed => {
            crate::log::log_line_verbose(&handle, "theme", &format!("Theme `{watched}` changed"));
            let _ = handle.emit(EVENT, json!({ "id": &watched }));
        }
        WatchSignal::Failed(message) => {
            crate::log::log_line(&handle, "theme", &format!("Theme watch failed: {message}"));
        }
    })?;

    let message = if started {
        format!("Watching theme `{id}` for changes")
    } else {
        format!("Not watching theme `{id}` — no installed theme directory")
    };
    crate::log::log_line(app, "theme", &message);
    Ok(())
}

/// Stop watching, if anything is being watched. A no-op when nothing is.
pub fn stop(app: &AppHandle) -> Result<(), String> {
    // Taken under the lock, dropped after it is released: tearing a watch down
    // joins its debounce thread, which has no reason to run while it is held.
    let stopped = take(&app.state::<AppState>().theme_watch)?;
    if let Some(watched) = stopped {
        crate::log::log_line(
            app,
            "theme",
            &format!("Stopped watching theme `{}`", watched.id),
        );
    }
    Ok(())
}

/// The body of [`watch`], with the themes root and the notification sink passed
/// in so a test can drive a scratch directory and see what the frontend would be
/// told. Returns whether a watch is now running; an id that cannot name a
/// directory — an unusable one, or one with nothing installed — leaves the slot
/// empty and reports `false` rather than erroring, since an id that stops
/// existing mid-flight is an ordinary race.
fn start(
    slot: &Mutex<Option<ThemeWatch>>,
    themes_root: &Path,
    id: &str,
    sink: impl Fn(WatchSignal) + Send + 'static,
) -> Result<bool, String> {
    // Replace, never accumulate: the previous watch is torn down — and with it
    // the OS watch — before a new one exists, so no stale directory can fire.
    drop(take(slot)?);

    if !crate::theme::is_usable_id(id) {
        return Ok(false);
    }
    let dir = themes_root.join(id);
    if !dir.is_dir() {
        return Ok(false);
    }

    let (tx, rx) = mpsc::channel();
    let stopped = Arc::new(AtomicBool::new(false));
    let thread = std::thread::Builder::new()
        .name("tetra-theme-watch".to_string())
        .spawn({
            let stopped = Arc::clone(&stopped);
            move || debounce(rx, stopped, sink)
        })
        .map_err(|e| format!("Could not start the theme watcher: {e}"))?;

    let watcher = RecommendedWatcher::new(
        move |event: notify::Result<notify::Event>| {
            let signal = match event {
                Ok(_) => WatchSignal::Changed,
                Err(error) => WatchSignal::Failed(error.to_string()),
            };
            // A closed channel only means the watch is being torn down.
            let _ = tx.send(signal);
        },
        notify::Config::default(),
    )
    .map_err(|e| format!("Could not watch {}: {e}", dir.display()))?;

    let mut watcher = watcher;
    if let Err(error) = watcher.watch(&dir, RecursiveMode::Recursive) {
        // The directory can be deleted between the check above and here; that is
        // the same "nothing to watch" case, not a failure to report.
        if !dir.is_dir() {
            return Ok(false);
        }
        return Err(format!("Could not watch {}: {error}", dir.display()));
    }

    let watch = ThemeWatch {
        id: id.to_string(),
        watcher: Some(watcher),
        stopped,
        thread: Some(thread),
    };
    // The displaced watch is torn down after the guard is released: dropping one
    // joins its debounce thread, which has no reason to run under the lock.
    let displaced = {
        let mut held = slot.lock().map_err(|_| POISONED.to_string())?;
        held.replace(watch)
    };
    drop(displaced);
    Ok(true)
}

/// Coalesce the watcher's events into one signal per burst: a signal starts a
/// window, each further one in that window extends it, and only a full window of
/// quiet means the burst is over — so the frontend is woken once per save, not
/// once per file the save touched.
fn debounce(rx: Receiver<WatchSignal>, stopped: Arc<AtomicBool>, sink: impl Fn(WatchSignal)) {
    let mut pending = false;
    loop {
        let next = if pending {
            rx.recv_timeout(DEBOUNCE)
        } else {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };

        match next {
            Ok(WatchSignal::Changed) => pending = true,
            // A watcher error is not part of the burst: report it as it arrives.
            Ok(WatchSignal::Failed(message)) => sink(WatchSignal::Failed(message)),
            Err(RecvTimeoutError::Timeout) => {
                if !stopped.load(Ordering::Relaxed) {
                    sink(WatchSignal::Changed);
                }
                pending = false;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Drop whatever watch `slot` holds, handing it back so the caller can say what
/// it stopped.
fn take(slot: &Mutex<Option<ThemeWatch>>) -> Result<Option<ThemeWatch>, String> {
    let mut held = slot.lock().map_err(|_| POISONED.to_string())?;
    Ok(held.take())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// How long a test waits for an event before calling it lost: CI machines
    /// are slow, and a missed deadline here is a false failure, not a missed
    /// debounce.
    const WAIT: Duration = Duration::from_secs(5);

    /// Quiet for this long after a burst and nothing else was coming.
    const QUIET: Duration = Duration::from_millis(4 * DEBOUNCE.as_millis() as u64);

    /// Generous bound between a write and its event. The debounce itself is
    /// [`DEBOUNCE`], so exceeding this means the event was lost or the watch was
    /// never armed — not that the machine was slow.
    const WITHIN: Duration = Duration::from_millis(20 * DEBOUNCE.as_millis() as u64);

    /// A scratch themes root unique to one test, the way `theme` does it (no
    /// `tempfile` dependency).
    fn scratch(tag: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let seq = N.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-theme-watch-{tag}-{nanos}-{seq}"));
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        dir
    }

    /// An installed theme inside `root`.
    fn installed(root: &Path, id: &str) -> PathBuf {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).expect("could not create theme dir");
        dir
    }

    /// Start a watch whose signals land on a channel: `(started, signals)`.
    fn watch_via(
        slot: &Mutex<Option<ThemeWatch>>,
        themes_root: &Path,
        id: &str,
    ) -> (bool, Receiver<WatchSignal>) {
        let (tx, rx) = mpsc::channel();
        let started = start(slot, themes_root, id, move |signal| {
            let _ = tx.send(signal);
        })
        .expect("nothing here may fail");
        (started, rx)
    }

    /// Assert the next signal is the change the frontend is woken for, and that
    /// it reached the caller within [`WITHIN`] of `since` — the debounce itself
    /// is [`DEBOUNCE`], so anything near this bound means the event was lost or
    /// the watch was never armed, not that the machine was slow.
    fn expect_change_within(signals: &Receiver<WatchSignal>, since: std::time::Instant) {
        let signal = signals.recv_timeout(WAIT).expect("expected a change");
        assert!(
            matches!(signal, WatchSignal::Changed),
            "expected a change, got a failure"
        );
        let elapsed = since.elapsed();
        assert!(
            elapsed < WITHIN,
            "a change took {elapsed:?} to arrive after the write"
        );
    }

    /// The ordinary case: a save under the watched directory reaches the caller.
    #[test]
    fn a_write_under_the_watched_directory_fires() {
        let root = scratch("write");
        let dir = installed(&root, "dev.one");
        let slot = Mutex::new(None);
        let (started, signals) = watch_via(&slot, &root, "dev.one");

        assert!(started, "an installed theme must be watchable");

        let wrote = std::time::Instant::now();
        std::fs::write(dir.join("tokens.json"), "{}").expect("write");

        expect_change_within(&signals, wrote);
    }

    /// The point of the debounce: a burst of saves coalesces into one event, not
    /// one per write.
    #[test]
    fn a_burst_of_writes_fires_once() {
        let root = scratch("burst");
        let dir = installed(&root, "dev.burst");
        let slot = Mutex::new(None);
        let (_started, signals) = watch_via(&slot, &root, "dev.burst");

        // Format-on-save rewrites every stylesheet, then the palette again.
        let wrote = std::time::Instant::now();
        for n in 0..4 {
            std::fs::write(dir.join(format!("style-{n}.css")), "body{}").expect("write");
        }
        std::fs::write(dir.join("tokens.json"), "{}").expect("write");

        expect_change_within(&signals, wrote);

        assert!(
            matches!(signals.recv_timeout(QUIET), Err(RecvTimeoutError::Timeout)),
            "the burst must fire once, not once per write"
        );
    }

    /// A second watch replaces the first: the directory it left behind goes quiet.
    #[test]
    fn a_second_watch_stops_watching_the_first() {
        let root = scratch("replace");
        let first = installed(&root, "dev.first");
        let second = installed(&root, "dev.second");
        let slot = Mutex::new(None);

        let (_started, first_signals) = watch_via(&slot, &root, "dev.first");
        let (started, second_signals) = watch_via(&slot, &root, "dev.second");
        assert!(started, "the replacement must be watchable");

        std::fs::write(first.join("tokens.json"), "{}").expect("write");
        let wrote = std::time::Instant::now();
        std::fs::write(second.join("tokens.json"), "{}").expect("write");

        expect_change_within(&second_signals, wrote);
        assert!(
            first_signals.recv_timeout(QUIET).is_err(),
            "the replaced theme must have been dropped"
        );
    }

    /// A theme with nothing on disk — a built-in preset, a deleted theme, an id
    /// that could name a directory outside the themes root — is not an error.
    #[test]
    fn nothing_to_watch_is_not_an_error() {
        let root = scratch("missing");
        let slot = Mutex::new(None);

        for id in ["neutral", "dev.deleted", "../escaped"] {
            let (started, signals) = watch_via(&slot, &root, id);

            assert!(!started, "`{id}` has nothing to watch");
            assert!(
                signals.recv_timeout(QUIET).is_err(),
                "`{id}` reported an event"
            );
        }
    }

    /// A stopped watch stays stopped: the directory it was watching is silent.
    #[test]
    fn a_stopped_watch_reports_nothing() {
        let root = scratch("stopped");
        let dir = installed(&root, "dev.stopped");
        let slot = Mutex::new(None);
        let (started, signals) = watch_via(&slot, &root, "dev.stopped");
        assert!(started);

        drop(take(&slot).expect("nothing here may fail"));

        std::fs::write(dir.join("tokens.json"), "{}").expect("write");

        assert!(
            signals.recv_timeout(QUIET).is_err(),
            "a stopped watch must not fire"
        );
    }

    /// Nothing watched is not an error to stop: a stray call after the watch
    /// already stopped must stay quiet.
    #[test]
    fn taking_nothing_is_none() {
        let slot = Mutex::new(None);

        assert!(take(&slot).expect("nothing here may fail").is_none());
    }
}
