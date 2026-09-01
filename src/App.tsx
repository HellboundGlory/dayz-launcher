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
import { OnboardingModal } from "./components/onboarding-modal";
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
import { listen, emit } from "@tauri-apps/api/event";
// Static import: window-resize-handles already pulls this in statically anyway.
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";

/** Debounce window for coalescing backend refresh events into one reload. */
const RELOAD_THROTTLE_MS = 250;

// Longer throttle while discovery is streaming — discovery-progress fires
// several times a second and each reload re-queries the whole table.
const DISCOVERY_RELOAD_THROTTLE_MS = 1500;

/** Interval between Steam-availability rechecks while it's down. */
const STEAM_RETRY_MS = 4000;

/** Poll interval for detecting a lost Steam connection (cheap local check). */
const CONNECTION_POLL_MS = 3000;

/** No urgency on release checks, so this stays infrequent. */
const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

/** Let "Ready — 100%" show briefly before revealing the launcher. */
const SPLASH_READY_MS = 400;

/** Hard ceiling so a stuck backend can never leave the splash up forever. */
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

  // Each tab is a filter preset, not just a highlight toggle.
  const handleViewChange = useCallback(
    (view: ViewId) => {
      setActiveView(view);
      setSettingsOpen(false);
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
  // Lets scheduleReload read `discovering` without depending on it.
  const discoveringRef = useRef(false);
  useEffect(() => {
    discoveringRef.current = discovering;
  }, [discovering]);
  /** Set the moment discovery starts; stays true for the session. The splash
      uses it to tell "connected but not yet fetching" from "really done". */
  const [discoveryStarted, setDiscoveryStarted] = useState(false);
  /** Live count from `discovery-progress` (`payload.found`), currently ignored
      otherwise — the splash shows it as the "Found N servers" detail line. */
  const [discovered, setDiscovered] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const autoRefreshSecs = useSettingsStore((s) => s.autoRefreshIntervalSecs);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const onboardingDismissed = useSettingsStore((s) => s.onboardingDismissed);

  // Decided once, off the settings snapshot from the moment they finish
  // loading — re-deriving this on every render would hide the modal the
  // instant it fills in the very fields it's asking about.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingDecided = useRef(false);
  useEffect(() => {
    if (onboardingDecided.current || !settingsLoaded) return;
    onboardingDecided.current = true;
    if (!onboardingDismissed && profileName.trim() === "" && dayzPath === null) {
      setShowOnboarding(true);
    }
  }, [settingsLoaded, onboardingDismissed, profileName, dayzPath]);
  // Guards handleRefresh against overlapping manual/auto-refresh runs.
  const refreshInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ total: 0, populated: 0 });
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  // Dismissed for this session only; returns next launch if still pending.
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  /** Registry fell back to in-memory: nothing the user saves will survive. */
  const [storageDegraded, setStorageDegraded] = useState(false);

  useEffect(() => {
    registryDegraded()
      .then(setStorageDegraded)
      .catch(() => {});
  }, []);

  // Coalesces backend refresh events into one throttled reload instead of
  // re-querying on every single one.
  const reloadTimer = useRef<number | null>(null);
  /** Last "found" count logged from `discovery-progress`, to keep the log thin. */
  const discoveryLogFloor = useRef(0);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current !== null) return;
    const delay = discoveringRef.current ? DISCOVERY_RELOAD_THROTTLE_MS : RELOAD_THROTTLE_MS;
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      void logClient("reload", "scheduleReload: dispatching reload", true);
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
      getServerCounts().then(setCounts).catch(() => {});
    }, delay);
  }, [triggerReload]);

  useEffect(
    () => () => {
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
    },
    [],
  );

  // Load persisted settings before anything can overwrite them.
  const loadSettings = useSettingsStore((s) => s.load);
  const flushSettings = useSettingsStore((s) => s.flush);

  // Independent of Steam — just a GitHub request.
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

  // App-level so "is DayZ running" survives the details panel unmounting.
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

  // First population after Steam connects. Skips the bulk A2S probe so the
  // table paints immediately from Steam's own data; mod counts and live
  // pings arrive once the user hits REFRESH.
  const runInitialLoad = useCallback(async () => {
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

  // Extracted from the mount effect so Retry and the automatic recheck run
  // the same path as the first attempt.
  const connectSteam = useCallback(
    async (manual = false) => {
      // Ref rather than state: needs to be accurate at call time, not last render.
      if (connectInFlight.current) return;
      connectInFlight.current = true;
      // Manual retry resets the auto-retry budget.
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
        // Fresh object per attempt, so the retry effect re-arms even on an
        // identical failure.
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

  // Re-check on a timer while Steam is down, bounded by autoRetryLimit.
  useEffect(() => {
    if (steamConnected || !steamError?.autoRetry || autoRetryExhausted) return;
    const timer = window.setTimeout(() => {
      void connectSteam();
    }, STEAM_RETRY_MS);
    return () => clearTimeout(timer);
  }, [steamConnected, steamError, autoRetryExhausted, connectSteam]);

  // Live-monitor the connection once it's up; stops on the first drop.
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

  // One-shot retry once the backend confirms its registry is actually open —
  // startup's own queries can otherwise race ahead of it.
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

  // dzsa://connect/... link from the OS protocol handler (src-tauri/src/protocol.rs).
  // Selects the server but never auto-launches — joining still needs the button.
  useEffect(() => {
    const unlistenConnect = listen<{ ip: string; queryPort: number; favourite: boolean }>(
      "dzsa-connect",
      (event) => {
        const { ip, queryPort, favourite } = event.payload;
        setActiveView("servers");
        void getServer(`${ip}:${queryPort}`, queryPort)
          .then((server) => {
            if (!server) {
              // Not an error — registry just hasn't discovered this server yet.
              setError(
                `${ip}:${queryPort} isn't in your server list yet — press DISCOVER, then try the link again.`,
              );
              return;
            }
            useServerStore.getState().setSelectedServer(server);
            if (favourite && !server.favourite) {
              useServerStore.getState().toggleFavourite(server.addr);
              void toggleFavourite(server.addr, server.query_port, true).catch((e) => {
                console.error("Failed to persist favourite from dzsa:// link:", e);
                useServerStore.getState().toggleFavourite(server.addr);
              });
            }
          })
          .catch((e) => {
            console.error("Failed to resolve dzsa:// link target:", e);
            setError(`Could not look up ${ip}:${queryPort}: ${String(e)}`);
          });
      },
    );
    return () => {
      unlistenConnect.then((fn) => fn());
    };
  }, []);

  // Re-probes every server in the current filtered list (distinct from
  // DISCOVER, which pulls new servers in).
  const handleRefresh = useCallback(async () => {
    if (!steamConnected) return;
    // Guards against overlapping manual/auto-refresh runs.
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
  }, [steamConnected, triggerReload]);

  // Auto-refresh on a timer; reuses handleRefresh so it inherits the same guards.
  useEffect(() => {
    if (!settingsLoaded || autoRefreshSecs <= 0 || !steamConnected) return;
    const id = window.setInterval(() => {
      // Nothing worth re-querying while hidden in the tray.
      if (document.hidden) return;
      void handleRefresh();
    }, autoRefreshSecs * 1000);
    return () => clearInterval(id);
  }, [settingsLoaded, autoRefreshSecs, steamConnected, handleRefresh]);

  // ── Startup splash (separate window) ────────────────────────────
  // `main` stays hidden until startup is ready or Steam fails; the last
  // clause lets a genuinely empty result dismiss once discovery finishes.
  const startupReady =
    steamConnected &&
    mapsLoaded &&
    hasLoadedOnce &&
    (serverCount > 0 || (discoveryStarted && !discovering));

  // Reveals main and closes the splash exactly once — a second call would
  // rip focus back from the game, so `revealDone` gates any re-fire.
  const revealDone = useRef(false);
  const revealLauncherWhenReady = useCallback(() => {
    if (revealDone.current) return;
    revealDone.current = true;
    void (async () => {
      const self = getCurrentWindow();
      try {
        await self.show();
        await self.setFocus();
      } catch (e) {
        console.error("Could not reveal the launcher window:", e);
      }
      // Close splash only after main is shown, to avoid a bare-desktop frame.
      try {
        const windows = await getAllWindows();
        await windows.find((w) => w.label === "splash")?.close();
      } catch (e) {
        console.error("Could not close the splash window:", e);
      }
    })();
  }, []);

  // Let "Ready" show briefly, then reveal. A Steam failure also reveals so
  // the required-modal is actionable.
  useEffect(() => {
    if (!(startupReady || steamError)) return;
    const t = window.setTimeout(revealLauncherWhenReady, SPLASH_READY_MS);
    return () => clearTimeout(t);
  }, [startupReady, steamError, revealLauncherWhenReady]);

  // Safety net: some Windows/WebView2 setups stall reloads while the window
  // is hidden, so force one the first time it becomes visible. Scoped to
  // `revealDone` so alt-tabbing back from DayZ doesn't retrigger it.
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

  // Status/% milestones in startup order; percentages are markers, not live progress.
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

  // Publish the current milestone to the splash window as it changes.
  const latestSplash = useRef(splash);
  useEffect(() => {
    latestSplash.current = splash;
    void logClient(
      "splash",
      `milestone ${splash.pct}% "${splash.status}" servers=${serverCount}`,
    );
    void emit("splash-progress", {
      status: splash.status,
      detail: splash.detail,
      pct: splash.pct,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splash.status, splash.detail, splash.pct]);

  // Replay the current milestone when the splash announces itself — it may
  // miss early events while still registering its listener.
  useEffect(() => {
    const pending = listen("splash-ready", () => {
      void emit("splash-progress", {
        status: latestSplash.current.status,
        detail: latestSplash.current.detail,
        pct: latestSplash.current.pct,
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

          {/* "Later" dismisses for this session only. */}
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
            /* Mods tab replaces the whole server-browser stack while active. */
        <ModsTab />
      ) : (
        <>
          <FilterBar onRefresh={handleRefresh} refreshing={refreshing} />

              {/* Not dismissible — favourites/recent are not being saved. */}
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

      {showOnboarding && steamConnected && (
        <OnboardingModal onDone={() => setShowOnboarding(false)} />
      )}

      <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} />

      {infoServer && <ServerInfoModal server={infoServer} onClose={() => setInfoServer(null)} />}

      {/* Blocking: nothing works without Steam. */}
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