import { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "./components/title-bar";
import { FilterBar } from "./components/filter-bar";
import { ServerTable } from "./components/server-table";
import { ServerDetails } from "./components/server-details";
import { FooterBar } from "./components/footer-bar";
import { SettingsModal } from "./components/settings-modal";
import { UpdateModal } from "./components/update-modal";
import { SteamRequiredModal } from "./components/steam-required-modal";
import type { SplashScreenProps } from "./components/splash-screen";
import { useServerStore } from "./stores/server-store";
import { useSettingsStore } from "./stores/settings-store";
import { useUpdateStore } from "./stores/update-store";
import { watchDayz } from "./stores/launch-store";
import {
  steamInit,
  asSteamInitError,
  steamConnectionState,
  discoverServers,
  refreshVisibleServers,
  getServerCounts,
  registryDegraded,
  type SteamInitError,
  type SteamInitFailure,
  type ModsPendingEntry,
} from "./lib/tauri";
import { listen } from "@tauri-apps/api/event";

/** Trailing window for coalescing backend progress events into one reload. */
const RELOAD_THROTTLE_MS = 250;

/**
 * How long to wait before re-checking whether Steam has appeared.
 *
 * Only runs for failures that can resolve on their own (`autoRetry`), so this
 * is the interval between "is Steam up yet?" checks while the user goes and
 * starts it — not a retry loop against a permanent failure.
 */
const STEAM_RETRY_MS = 4000;

/**
 * How often to check the live Steam connection once it's up.
 *
 * `steamConnected` was previously one-shot — set at startup and never
 * rechecked, so a backend connection lost later (Steam still running, our
 * process still running, but the session between them gone) left the title
 * bar claiming "Steam connected" indefinitely. The check itself is a local
 * atomic read on the backend, not a round trip to Steam, so polling this
 * often costs nothing.
 */
const CONNECTION_POLL_MS = 3000;

/**
 * How often to recheck for a new release once the app is running.
 *
 * Unlike the Steam connection, there's no urgency here — a few hours' delay
 * before noticing a new release costs nothing, so this is picked to be
 * unobtrusive rather than fast.
 */
const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * How long the splash lingers on "Ready — 100%" before the launcher is
 * revealed and the splash window is closed, so the completion reads as a step
 * rather than a snap.
 */
const SPLASH_READY_MS = 400;

/**
 * Fail-safe ceiling for the splash. A pathological backend must never be able
 * to leave the launcher hidden behind a static splash, so it always reveals
 * and closes eventually, even if `startupReady` never becomes true on its own.
 */
const SPLASH_FAILSAFE_MS = 120_000;

export function App() {
  const [activeTab, setActiveTab] = useState("servers");
  const selectedServer = useServerStore((s) => s.selectedServer);
  const triggerReload = useServerStore((s) => s.triggerReload);
  const setFilter = useServerStore((s) => s.setFilter);
  const serverCount = useServerStore((s) => s.servers.length);
  const mapsLoaded = useServerStore((s) => s.mapsLoaded);
  const hasLoadedOnce = useServerStore((s) => s.hasLoadedOnce);

  // The tabs were previously display-only — switching them changed the
  // highlight but not the query. Each one is just a filter preset.
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      setFilter({
        favourites_only: tab === "favorites",
        recent_only: tab === "recent",
      });
    },
    [setFilter],
  );
  const [steamConnected, setSteamConnected] = useState(false);
  const [steamError, setSteamError] = useState<SteamInitError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const connectInFlight = useRef(false);
  /** Consecutive failed attempts, reset whenever the failure kind changes. */
  const steamAttempts = useRef<{ kind: SteamInitFailure; count: number } | null>(null);
  const [autoRetryExhausted, setAutoRetryExhausted] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  /** Set the moment discovery starts; stays true for the session. The splash
      uses it to tell "connected but not yet fetching" from "really done". */
  const [discoveryStarted, setDiscoveryStarted] = useState(false);
  /** Live count from `discovery-progress` (`payload.found`), currently ignored
      otherwise — the splash shows it as the "Found N servers" detail line. */
  const [discovered, setDiscovered] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const autoRefreshSecs = useSettingsStore((s) => s.autoRefreshIntervalSecs);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  /** Guards the auto-refresh timer against overlapping runs. */
  const autoRefreshInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ total: 0, populated: 0 });
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  /**
   * The startup "update available" banner. `true` once dismissed for the
   * session — the badge stays as the persistent entry point, and the banner
   * returns next launch while an update is still pending.
   */
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  /** Registry fell back to in-memory: nothing the user saves will survive. */
  const [storageDegraded, setStorageDegraded] = useState(false);

  // Checked once. The flag is decided during backend setup and never changes.
  useEffect(() => {
    registryDegraded()
      .then(setStorageDegraded)
      .catch(() => {});
  }, []);

  /**
   * Coalesce reload requests.
   *
   * The backend emits `server-refreshed` as it works, and every one of those
   * used to trigger `triggerReload()` -> a fresh `get_server_list` invoke plus
   * a full re-render of every row. Over a refresh that is hundreds of round
   * trips against an unvirtualised table, which is a large part of why the app
   * feels locked up while discovering. Collapsing them onto a trailing timer
   * keeps the list live without re-querying per server.
   */
  const reloadTimer = useRef<number | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current !== null) return;
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
      getServerCounts().then(setCounts).catch(() => {});
    }, RELOAD_THROTTLE_MS);
  }, [triggerReload]);

  useEffect(
    () => () => {
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
    },
    [],
  );

  // Read persisted settings before anything reads them. The store refuses to
  // save until this has landed, so the defaults it starts with can't overwrite
  // the user's file.
  const loadSettings = useSettingsStore((s) => s.load);
  const flushSettings = useSettingsStore((s) => s.flush);

  // Independent of Steam entirely — a release check is just a request to
  // GitHub, so it runs regardless of whether Steam ever connects.
  const resolveInstalled = useUpdateStore((s) => s.resolveInstalled);
  const checkForUpdates = useUpdateStore((s) => s.checkNow);
  const updateAvailable = useUpdateStore((s) => s.available);

  useEffect(() => {
    void resolveInstalled();
    void checkForUpdates();
    const timer = window.setInterval(() => void checkForUpdates(), UPDATE_RECHECK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // App-level, not in the details panel: the panel unmounts when nothing is
  // selected, and "is DayZ running" has to stay true across that. See
  // `watchDayz`.
  useEffect(() => watchDayz(), []);

  // A pending debounced write would otherwise be lost when the window closes.
  useEffect(() => {
    const onHide = () => {
      void flushSettings();
    };
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSettings]);

  /**
   * First full population of the list. Only runs once Steam is connected.
   *
   * Deliberately does *not* follow discovery with a bulk A2S refresh. Steam's
   * server-list response already carries name/map/players/ping/locked/tags —
   * enough to paint the table immediately — and running an up-to-5000-server
   * probe pass here used to tie up the network and the registry's single
   * writer thread right when the table first appears, which made the REFRESH
   * button (now a small, targeted probe of whatever's on screen) feel stuck
   * for however long that pass took. Mod counts and live pings arrive the
   * moment the user hits REFRESH instead.
   */
  const runInitialLoad = useCallback(async () => {
    setDiscoveryStarted(true);
    setDiscovering(true);
    try {
      await discoverServers();
    } catch (e) {
      console.error("Discovery failed:", e);
    } finally {
      setDiscovering(false);
    }

    triggerReload();
    setRefreshedAt(new Date().toLocaleTimeString());
  }, [triggerReload]);

  /**
   * Attempt the Steam connection, and start loading if it works.
   *
   * Extracted from the mount effect so the startup prompt's Retry button and
   * the automatic re-check run exactly the same path as the first attempt —
   * a retry that succeeds has to kick off discovery too, which the old
   * mount-only version had no way to do.
   */
  const connectSteam = useCallback(
    async (manual = false) => {
      // Clicking Retry the instant the automatic re-check fires would otherwise
      // run two `SteamHandle::start` calls against each other. The backend
      // survives that (the loser is shut down), but there is no reason to make
      // it happen. A ref rather than the `connecting` state: this has to be
      // accurate at call time, not at the last render.
      if (connectInFlight.current) return;
      connectInFlight.current = true;
      // An explicit Retry is the user asking for a fresh go, so it restores the
      // full automatic budget rather than spending the last of it.
      if (manual) {
        steamAttempts.current = null;
        setAutoRetryExhausted(false);
      }
      setConnecting(true);
      try {
        await steamInit();
        setSteamConnected(true);
        setSteamError(null);
        steamAttempts.current = null;
        setAutoRetryExhausted(false);
        triggerReload();
        void runInitialLoad();
      } catch (e) {
        // A fresh object per attempt, so the retry effect below re-arms its
        // timer even when the failure is identical.
        const failure = asSteamInitError(e);
        const prior = steamAttempts.current;
        const count = prior?.kind === failure.kind ? prior.count + 1 : 1;
        steamAttempts.current = { kind: failure.kind, count };

        setSteamConnected(false);
        setSteamError(failure);
        setAutoRetryExhausted(
          failure.autoRetryLimit !== null && count >= failure.autoRetryLimit,
        );
      } finally {
        connectInFlight.current = false;
        setConnecting(false);
      }
    },
    [triggerReload, runInitialLoad],
  );

  useEffect(() => {
    void connectSteam();
    // Mount only: retries go through the prompt, not through a dependency
    // change on this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check on a timer while Steam is absent or still starting, so the prompt
  // clears itself once the user has Steam up. Kinds that cannot resolve by
  // waiting (out-of-date client, internal failure) never arm this, and the ones
  // that can are still bounded — see `InitFailure::auto_retry_limit`.
  useEffect(() => {
    if (steamConnected || !steamError?.autoRetry || autoRetryExhausted) return;
    const timer = window.setTimeout(() => {
      void connectSteam();
    }, STEAM_RETRY_MS);
    return () => clearTimeout(timer);
  }, [steamConnected, steamError, autoRetryExhausted, connectSteam]);

  // Live-monitor the connection once it's up. Stops itself the moment it
  // detects a drop — there is nothing to recover from in place, since
  // `steam_init` short-circuits once `ready` is set (see `SteamInitFailure`'s
  // `disconnected` kind), so re-polling a dead session would just report
  // success from it.
  useEffect(() => {
    if (!steamConnected) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void steamConnectionState().then((up) => {
        if (cancelled || up) return;
        setSteamConnected(false);
        setSteamError({
          kind: "disconnected",
          message: "The connection to Steam was lost while the launcher was running.",
          autoRetry: false,
          autoRetryLimit: 0,
        });
      });
    }, CONNECTION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [steamConnected]);

  useEffect(() => {
    const unlistenProgress = listen<{ tier: number; requests: number; found: number }>(
      "discovery-progress",
      (event) => {
        // The splash's live detail line ("Found N servers") reads this.
        setDiscovered(event.payload.found);
        scheduleReload();
      },
    );

    const unlistenRefreshed = listen("server-refreshed", () => {
      scheduleReload();
    });

    const unlistenModsPending = listen<ModsPendingEntry[]>("mods-pending", (event) => {
      useServerStore.getState().mergeModPending(event.payload);
    });

    // Completion is the one event that reloads immediately rather than on the
    // throttle, so the final state is never left a beat behind.
    const unlistenComplete = listen<{ ok: number; failed: number; scope?: string }>(
      "refresh-complete",
      (event) => {
        // Always reload — a row refresh has new data for the table too.
        triggerReload();
        // But only a full pass owns the spinner and the timestamp. A row
        // refresh finishing mid-pass would otherwise report the whole refresh
        // as done and stamp a time nothing had reached.
        if (event.payload?.scope === "row") return;
        setRefreshing(false);
        setRefreshedAt(new Date().toLocaleTimeString());
      },
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenRefreshed.then((fn) => fn());
      unlistenModsPending.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Re-probe every server in the current filtered list. The backend A2S probe
   * (`refresh_visible_servers`) takes explicit addresses and marks a miss as
   * OFFLINE, so passing the whole loaded list is the "refresh everything I can
   * see" action — distinct from DISCOVER, which pulls new servers in.
   */
  const handleRefresh = useCallback(async () => {
    if (!steamConnected) return;
    // An A2S refresh opens thousands of UDP sockets; don't run it against a
    // download the user is waiting on.
    if (useServerStore.getState().downloadsActive) {
      setError("Paused while mods are downloading — try again once they finish.");
      return;
    }
    const { servers } = useServerStore.getState();
    if (servers.length === 0) return;
    // The whole list, not just the rows currently mounted by the virtualizer.
    // Probing only the on-screen range made the button look broken — it
    // re-probed whatever was rendered (up to a page) and left the rest with
    // stale "?" mod counts, so a refetch "did nothing" for most rows.
    const targets = servers.map((s) => ({ addr: s.addr, query_port: s.query_port }));

    setRefreshing(true);
    setError(null);
    try {
      await refreshVisibleServers(targets, "visible");
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }, [steamConnected]);

  // Auto-refresh on a timer.
  //
  // `autoRefreshIntervalSecs` has been persisted since the first release with
  // nothing whatsoever reading it — the setting existed, defaulted to 60, and
  // never refreshed anything. This is the loop behind it.
  //
  // It reuses `handleRefresh` rather than calling the backend directly, so the
  // automatic path inherits every guard the button has: Steam connected, no
  // download in flight, and only the rows actually on screen.
  useEffect(() => {
    if (!settingsLoaded || autoRefreshSecs <= 0 || !steamConnected) return;
    const id = window.setInterval(() => {
      // A slow refresh must not have another stacked on top of it — with a
      // 30-second interval and a window full of dead servers, it can still be
      // running when the next tick arrives.
      if (autoRefreshInFlight.current) return;
      // Nothing worth re-querying while hidden in the tray.
      if (document.hidden) return;
      autoRefreshInFlight.current = true;
      void handleRefresh().finally(() => {
        autoRefreshInFlight.current = false;
      });
    }, autoRefreshSecs * 1000);
    return () => clearInterval(id);
  }, [settingsLoaded, autoRefreshSecs, steamConnected, handleRefresh]);

  // ── Startup splash (separate window) ────────────────────────────
  // `main` stays hidden while the 860×484 splash window carries the load. We
  // publish real progress to it, and once startup is ready (or Steam fails and
  // the required-modal must take over) we reveal the launcher and close the
  // splash. `startupReady`'s last clause lets a genuine empty result still
  // dismiss once discovery has finished, rather than waiting on rows that will
  // never come.
  const startupReady =
    steamConnected &&
    mapsLoaded &&
    hasLoadedOnce &&
    (serverCount > 0 || (discoveryStarted && !discovering));

  // Failures are logged rather than swallowed. `show`/`setFocus` are IPC calls
  // gated by the window's capability, and a missing permission rejects the
  // promise instead of throwing anywhere visible — a bare `void` turned "the
  // launcher is not allowed to reveal itself" into "the splash closes and
  // nothing happens", with nothing in the console to say why.
  //
  // **One-shot by design.** This exists to dismiss the startup splash and raise
  // `main` exactly once. It must never run again mid-session: it calls
  // `self.show()` + `setFocus()`, and a second invocation after the launcher
  // has gone to the tray would rip it back over the game. That used to happen
  // when a mid-session Steam-connection blip set `steamError`/flipped
  // `startupReady`, re-arming the reveal effect below — so `revealDone` makes
  // only the first call past the gate, and a later re-fire is a no-op.
  const revealDone = useRef(false);
  const revealLauncherWhenReady = useCallback(() => {
    if (revealDone.current) return;
    revealDone.current = true;
    void import("@tauri-apps/api/window").then(
      async ({ getCurrentWindow, getAllWindows }) => {
        const self = getCurrentWindow();
        try {
          await self.show();
          await self.setFocus();
        } catch (e) {
          console.error("Could not reveal the launcher window:", e);
        }
        // Only after `main` is up. Closing the splash first would leave the
        // desktop bare for a frame if showing turns out to be slow.
        try {
          const windows = await getAllWindows();
          await windows.find((w) => w.label === "splash")?.close();
        } catch (e) {
          console.error("Could not close the splash window:", e);
        }
      },
    );
  }, []);

  // Give the "Ready — 100%" beat its moment, then reveal the launcher and
  // close the splash. A Steam failure also reveals: the Steam-required modal
  // has to be actionable even though startup never completed.
  useEffect(() => {
    if (!(startupReady || steamError)) return;
    const t = window.setTimeout(revealLauncherWhenReady, SPLASH_READY_MS);
    return () => clearTimeout(t);
  }, [startupReady, steamError, revealLauncherWhenReady]);

  // Fail-safe: a pathological backend must never leave the launcher hidden
  // behind a static splash, so always reveal it eventually.
  useEffect(() => {
    const t = window.setTimeout(revealLauncherWhenReady, SPLASH_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, [revealLauncherWhenReady]);

  // Status / % milestones, in the order startup passes through them. The
  // percentages are cumulative markers along that journey, not live progress —
  // on a warm registry the splash flashes through 15→45→100 in well under a
  // second, which is exactly why it "only lingers when it actually takes a
  // while".
  const splash: SplashScreenProps = (() => {
    if (!steamConnected) {
      return { status: "Connecting to Steam…", pct: 15 };
    }
    if (!discoveryStarted || discovering) {
      return {
        status: "Fetching servers from Steam…",
        pct: 45,
        detail:
          discovered > 0
            ? `Found ${discovered.toLocaleString()} servers`
            : undefined,
      };
    }
    if (serverCount === 0) {
      return { status: "Propagating server list…", pct: 70 };
    }
    if (!mapsLoaded) {
      return { status: "Loading server maps…", pct: 95 };
    }
    return { status: "Ready", pct: 100 };
  })();

  // Publish the current milestone to the splash window as it changes. Emitted
  // app-wide, so the separate `splash` window's `listen` picks it up. The ref
  // is kept in step here so the replay below always has the live milestone.
  const latestSplash = useRef(splash);
  useEffect(() => {
    latestSplash.current = splash;
    void import("@tauri-apps/api/event").then(({ emit }) => {
      void emit("splash-progress", {
        status: splash.status,
        detail: splash.detail,
        pct: splash.pct,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splash.status, splash.detail, splash.pct]);

  // Replay the current milestone when the splash announces itself.
  //
  // Each milestone is emitted exactly once, as it is reached, so anything that
  // happens before the splash window finishes registering its listener is gone
  // for good — and registering it is an async IPC round trip that races this
  // window's startup. On a warm registry startup can pass 15→45→100 before the
  // splash is listening, which is precisely how it ends up reading
  // "Starting… 0%" for the entire load.
  useEffect(() => {
    const pending = listen("splash-ready", () => {
      void import("@tauri-apps/api/event").then(({ emit }) => {
        void emit("splash-progress", {
          status: latestSplash.current.status,
          detail: latestSplash.current.detail,
          pct: latestSplash.current.pct,
        });
      });
    });
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0b0f17]">
      <TitleBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        steamConnected={steamConnected}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Prominent startup alert for a pending update: not a dot to hunt for,
          a bar at the very top. Opens the same update dialog as the badge;
          "Later" dismisses for this session only. */}
      {updateAvailable && !updateBannerDismissed && (
        <div className="flex items-center gap-3 border-b border-[#38bdf8]/30 bg-[#38bdf8]/10 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#38bdf8]">
            Update available
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#f1f5f9]">
            Tetra Launcher v{updateAvailable.version} is ready to install.
          </span>
          <button
            onClick={() => {
              setUpdateBannerDismissed(true);
              setUpdateOpen(true);
            }}
            className="shrink-0 rounded bg-[#38bdf8] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0b0f17] transition-colors hover:bg-[#7dd3fc]"
          >
            Update
          </button>
          <button
            onClick={() => setUpdateBannerDismissed(true)}
            className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] transition-colors hover:text-[#f1f5f9]"
          >
            Later
          </button>
        </div>
      )}

      <FilterBar onRefresh={handleRefresh} refreshing={refreshing} />

      {/* Not dismissible: it stays true for the whole session, and silently
          losing favourites is exactly what this exists to prevent. */}
      {storageDegraded && (
        <div className="flex items-center gap-2 border-b border-[#f59e0b]/30 bg-[#f59e0b]/5 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase text-[#f59e0b]">STORAGE</span>
          <span className="text-[11px] text-[#f1f5f9]">
            The server database could not be opened, so this session is running from memory —
            favourites and recently-played will not be saved.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 border-b border-[#ef4444]/30 bg-[#ef4444]/5 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase text-[#ef4444]">ERROR</span>
          <span className="text-[11px] text-[#f1f5f9] truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-[10px] text-[#64748b] hover:text-[#f1f5f9] shrink-0"
          >
            DISMISS
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-[#1e293b] bg-[#0b0f17] px-3 py-1.5">
        <div className={discovering ? "size-1.5 rounded-full bg-[#f59e0b] animate-pulse" : refreshing ? "size-1.5 rounded-full bg-[#38bdf8] animate-pulse" : "size-1.5 rounded-full bg-[#22c55e]"} />
        <span className="text-[10px] text-[#64748b]">
          {discovering
            ? "Discovering servers from Steam..."
            : refreshing
              ? "Probing server details..."
              : `Live · ${refreshedAt ?? "waiting"}`}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1e293b]">
          <ServerTable />
        </div>
        <div
          className="w-[340px] flex-shrink-0 flex-col overflow-hidden bg-[#111823]"
          style={{ display: selectedServer ? "flex" : "none" }}
        >
          <ServerDetails />
        </div>
      </div>

      <FooterBar
        servers={counts.total}
        populated={counts.populated}
        refreshedAt={refreshedAt}
        steamConnected={steamConnected}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <UpdateModal
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
      />

      {/* Blocking: nothing in the launcher works without Steam, and the mod
          panel reads a missing Steam connection as "no mods needed". */}
      {!steamConnected && steamError && (
        <SteamRequiredModal
          error={steamError}
          checking={connecting}
          exhausted={autoRetryExhausted}
          onRetry={() => void connectSteam(true)}
        />
      )}
    </div>
  );
}