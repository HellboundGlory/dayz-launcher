import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { WindowResizeHandles } from "./components/window-resize-handles";
import { Sidebar, type ViewId } from "./components/sidebar";
import { WindowControls } from "./components/window-controls";
import { FilterBar } from "./components/filter-bar";
import { ServerList } from "./components/server-list";
import { ServerInfoModal } from "./components/server-info-modal";
import { ModsTab } from "./components/mods-tab";
import { FooterBar } from "./components/footer-bar";
import { SettingsView } from "./components/settings-view";
import { UpdateModal } from "./components/update-modal";
import { SteamRequiredModal } from "./components/steam-required-modal";
import type { SplashScreenProps } from "./components/splash-screen";
import { useServerStore } from "./stores/server-store";
import { useSettingsStore } from "./stores/settings-store";
import { useUpdateStore } from "./stores/update-store";
import { watchDayz } from "./stores/launch-store";
import type { Server } from "./types/server";
import {
  steamInit,
  asSteamInitError,
  steamConnectionState,
  discoverServers,
  refreshVisibleServers,
  getServerCounts,
  registryDegraded,
  getServer,
  toggleFavourite,
  type SteamInitError,
  type SteamInitFailure,
  type ModsPendingEntry,
  logClient,
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
  const [activeView, setActiveView] = useState<ViewId>("servers");
  /** The row whose ⋯ menu asked for "More info" — drives the M1 modal. */
  const [infoServer, setInfoServer] = useState<Server | null>(null);
  /** Mirrors the sidebar's collapse so `--side-w` tracks it on the shell. */
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const triggerReload = useServerStore((s) => s.triggerReload);
  const setFilter = useServerStore((s) => s.setFilter);
  const serverCount = useServerStore((s) => s.servers.length);
  const mapsLoaded = useServerStore((s) => s.mapsLoaded);
  const hasLoadedOnce = useServerStore((s) => s.hasLoadedOnce);

  // The tabs were previously display-only — switching them changed the
  // highlight but not the query. Each one is just a filter preset.
  const handleViewChange = useCallback(
    (view: ViewId) => {
      setActiveView(view);
      setFilter({
        favourites_only: view === "fav",
        recent_only: view === "recent",
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
  /** Guards `handleRefresh` against overlapping runs — the manual button and
      the auto-refresh timer both go through it, and `refreshing` state alone
      isn't enough: the timer calls `handleRefresh` directly, bypassing the
      button's `disabled` prop. */
  const refreshInFlight = useRef(false);
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
  /** Last "found" count logged from `discovery-progress`, to keep the log thin. */
  const discoveryLogFloor = useRef(0);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current !== null) return;
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      void logClient("reload", "scheduleReload: dispatching reload");
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
    // Splash-70% diagnostics (progress.md): timelog the whole startup chain so
    // a log from an affected machine shows where it stalls.
    void logClient("startup", "runInitialLoad: start");
    setDiscoveryStarted(true);
    setDiscovering(true);
    try {
      await discoverServers();
    } catch (e) {
      void logClient("startup", "runInitialLoad: discovery threw: " + String(e));
      console.error("Discovery failed:", e);
    } finally {
      setDiscovering(false);
    }

    void logClient("startup", "runInitialLoad: discovery settled, dispatching final reload");
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

  /**
   * Splash-70% fix (progress.md): the backend now emits this once, the
   * instant its registry finishes opening. Startup's own queries fire the
   * moment this window loads and can race ahead of that — every one of the
   * three fixed attempts in `runInitialLoad`/`connectSteam` can fail with
   * "Registry not initialized" before the backend catches up, and until now
   * nothing retried after those three were spent, so a slow-to-open registry
   * left the splash stuck at 70% forever. This is the retry: one more reload,
   * fired exactly once, whenever the backend says it's actually ready.
   */
  const registryReadyHandled = useRef(false);
  useEffect(() => {
    const unlistenRegistryReady = listen<{ degraded: boolean }>("registry-ready", (event) => {
      if (registryReadyHandled.current) return;
      registryReadyHandled.current = true;
      void logClient(
        "startup",
        `registry-ready received (degraded=${event.payload.degraded}) -> scheduleReload`,
      );
      scheduleReload();
    });
    return () => {
      unlistenRegistryReady.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<{ tier: number; requests: number; found: number }>(
      "discovery-progress",
      (event) => {
        // The splash's live detail line ("Found N servers") reads this.
        setDiscovered(event.payload.found);
        // Log a thin sample (first + every 1000) — the full event stream
        // during discovery would otherwise be the whole log.
        if (
          discoveryLogFloor.current === 0 ||
          event.payload.found - discoveryLogFloor.current >= 1000
        ) {
          discoveryLogFloor.current = event.payload.found;
          void logClient("discovery", `discovery-progress: found ${event.payload.found}`);
        }
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

  // A `dzsa://connect/...` link, from the OS protocol handler (see
  // `src-tauri/src/protocol.rs`) — either this process's own cold-start argv,
  // or a second launch's argv the single-instance plugin forwarded here.
  // Selects (and optionally favourites) the named server; deliberately never
  // auto-launches DayZ — joining still needs the user to press the button
  // themselves, so a webpage can't spawn the game unattended.
  useEffect(() => {
    const unlistenConnect = listen<{ ip: string; queryPort: number; favourite: boolean }>(
      "dzsa-connect",
      (event) => {
        const { ip, queryPort, favourite } = event.payload;
        setActiveView("servers");
        void getServer(`${ip}:${queryPort}`, queryPort).then((server) => {
          if (!server) return;
          useServerStore.getState().setSelectedServer(server);
          if (favourite && !server.favourite) {
            useServerStore.getState().toggleFavourite(server.addr);
            void toggleFavourite(server.addr, server.query_port, true).catch((e) => {
              console.error("Failed to persist favourite from dzsa:// link:", e);
              useServerStore.getState().toggleFavourite(server.addr);
            });
          }
        });
      },
    );
    return () => {
      unlistenConnect.then((fn) => fn());
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
    // A manual click and the auto-refresh timer can both reach this function;
    // without this guard a slow refresh (a big list, or a bad network) could
    // still be running when the other trigger fires, and whichever finished
    // first would flip `refreshing` back off while the other pass kept going
    // in the background — the button/indicator would then lie about whether a
    // refresh was actually in flight.
    if (refreshInFlight.current) return;
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

    refreshInFlight.current = true;
    setRefreshing(true);
    setError(null);
    try {
      await refreshVisibleServers(targets, "visible");
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      refreshInFlight.current = false;
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
      // Nothing worth re-querying while hidden in the tray.
      if (document.hidden) return;
      // `handleRefresh` itself guards against overlapping runs (manual click
      // or a previous tick still in flight), so no separate check is needed
      // here.
      void handleRefresh();
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

  /**
   * Splash-70% safety net (fix direction B, see progress.md).
   *
   * The `main` window stays hidden through startup, and on some Windows
   * machines WebView2 stalls the timer-driven reload chain while a window is
   * not visible — so the list never fills and the splash waits at
   * "Propagating server list…" forever. The first time this window actually
   * becomes visible (e.g. a tray-icon reveal, exactly what the manual
   * workaround did) we force the same reload the tab-click used to.
   *
   * Scoped to `revealDone`: once the normal reveal has happened the window
   * turning visible again (alt-tab back from DayZ) must not reload.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (revealDone.current) return;
      void logClient("reload", "window became visible -> scheduleReload (safety net)");
      scheduleReload();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [scheduleReload]);

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
    // Splash-70% diagnostic: every milestone transition is timelogged with the
    // server-store count, so a stuck { pct: 70 } is visible in the log.
    void logClient(
      "splash",
      `milestone ${splash.pct}% "${splash.status}" servers=${serverCount}`,
    );
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
            <div
      className="relative flex h-screen flex-col overflow-hidden rounded-[8px] border border-line bg-bg"
      style={{ "--side-w": sideCollapsed ? "52px" : "220px" } as CSSProperties}
          >
      <WindowResizeHandles />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeView={activeView}
          onViewChange={handleViewChange}
        steamConnected={steamConnected}
          settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
          onCloseSettings={() => setSettingsOpen(false)}
          onCollapsedChange={setSideCollapsed}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <WindowControls />

          {/* Prominent startup alert for a pending update: not a dot to hunt
              for, a bar at the very top. Opens the same update dialog as the
              badge; "Later" dismisses for this session only. */}
      {updateAvailable && !updateBannerDismissed && (
            <div className="flex items-center gap-3 border-b border-accent-line bg-accent-soft px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
            Update available
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
            Tetra Launcher v{updateAvailable.version} is ready to install.
              </span>
              <button
            onClick={() => {
              setUpdateBannerDismissed(true);
              setUpdateOpen(true);
            }}
                className="shrink-0 rounded bg-accent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bg transition-[filter] hover:brightness-110"
              >
            Update
              </button>
              <button
            onClick={() => setUpdateBannerDismissed(true)}
                className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted transition-colors hover:text-ink"
              >
            Later
              </button>
            </div>
          )}

          {activeView === "mods" ? (
            /* The Mods tab is a full-width view, not a server filter: it
               replaces the whole server-browser stack (filter bar, status
               line, list) while it is active. */
        <ModsTab />
      ) : (
        <>
          <FilterBar onRefresh={handleRefresh} refreshing={refreshing} />

              {/* Not dismissible: it stays true for the whole session, and
                  silently losing favourites is exactly what this exists to
                  prevent. */}
          {storageDegraded && (
                <div className="flex items-center gap-2 border-b border-warn bg-warn-soft px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase text-warn">STORAGE</span>
                  <span className="text-[11px] text-ink">
                    The server database could not be opened, so this session is running from
                    memory — favourites and recently-played will not be saved.
          </span>
        </div>
      )}

          {error && (
                <div className="flex items-center gap-2 border-b border-danger bg-surface2 px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase text-danger">ERROR</span>
                  <span className="truncate text-[11px] text-ink">{error}</span>
          <button
                onClick={() => setError(null)}
                    className="ml-auto shrink-0 text-[10px] text-muted hover:text-ink"
          >
                DISMISS
          </button>
            </div>
          )}

              <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-1.5">
            <div
                  className={
                    discovering
                      ? "size-1.5 animate-pulse rounded-full bg-warn"
                : refreshing
                        ? "size-1.5 animate-pulse rounded-full bg-accent"
                        : "size-1.5 rounded-full bg-success"
                  }
      />
                <span className="text-[10px] text-muted">
              {discovering
                ? "Discovering servers from Steam..."
                : refreshing
                  ? "Probing server details..."
                  : `Live · ${refreshedAt ?? "waiting"}`}
          </span>
            </div>

              <ServerList view={activeView} onMoreInfo={setInfoServer} />
        </>
          )}

      <FooterBar
        servers={counts.total}
        populated={counts.populated}
        refreshedAt={refreshedAt}
        steamConnected={steamConnected}
      />
        </div>
          </div>

      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}

      <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} />

      {infoServer && <ServerInfoModal server={infoServer} onClose={() => setInfoServer(null)} />}

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