import { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "./components/title-bar";
import { FilterBar } from "./components/filter-bar";
import { ServerTable } from "./components/server-table";
import { ServerDetails } from "./components/server-details";
import { FooterBar } from "./components/footer-bar";
import { SettingsModal } from "./components/settings-modal";
import { SteamRequiredModal } from "./components/steam-required-modal";
import { useServerStore } from "./stores/server-store";
import { useSettingsStore } from "./stores/settings-store";
import { useUpdateStore } from "./stores/update-store";
import {
  steamInit,
  asSteamInitError,
  steamConnectionState,
  discoverServers,
  refreshServers,
  getServerCounts,
  type SteamInitError,
  type SteamInitFailure,
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

export function App() {
  const [activeTab, setActiveTab] = useState("servers");
  const selectedServer = useServerStore((s) => s.selectedServer);
  const triggerReload = useServerStore((s) => s.triggerReload);
  const setFilter = useServerStore((s) => s.setFilter);

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ total: 0, populated: 0 });
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  /** First full population of the list. Only runs once Steam is connected. */
  const runInitialLoad = useCallback(async () => {
    setDiscovering(true);
    try {
      await discoverServers();
    } catch (e) {
      console.error("Discovery failed:", e);
    } finally {
      setDiscovering(false);
    }

    try {
      await refreshServers();
    } catch (e) {
      console.error("Refresh failed:", e);
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
      () => {
        scheduleReload();
      },
    );

    const unlistenRefreshed = listen("server-refreshed", () => {
      scheduleReload();
    });

    // Completion is the one event that reloads immediately rather than on the
    // throttle, so the final state is never left a beat behind.
    const unlistenComplete = listen<{ ok: number; failed: number }>(
      "refresh-complete",
      () => {
        triggerReload();
        setRefreshing(false);
        setRefreshedAt(new Date().toLocaleTimeString());
      },
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenRefreshed.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!steamConnected) return;
    // An A2S refresh opens thousands of UDP sockets; don't run it against a
    // download the user is waiting on.
    if (useServerStore.getState().downloadsActive) {
      setError("Paused while mods are downloading — try again once they finish.");
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      await refreshServers();
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }, [steamConnected]);

  const handleDiscover = useCallback(async () => {
    if (!steamConnected || discovering) return;
    if (useServerStore.getState().downloadsActive) {
      setError("Paused while mods are downloading — try again once they finish.");
      return;
    }
    setDiscovering(true);
    setError(null);
    try {
      await discoverServers();
      await refreshServers();
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      setDiscovering(false);
    }
  }, [steamConnected, discovering]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0b0f17]">
      <TitleBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        steamConnected={steamConnected}
        onOpenSettings={() => setSettingsOpen(true)}
        updateAvailable={updateAvailable !== null}
      />

      <FilterBar
        onRefresh={handleRefresh}
        onDiscover={handleDiscover}
        refreshing={refreshing}
        discovering={discovering}
      />

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