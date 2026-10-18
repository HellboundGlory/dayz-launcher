import { useCallback, useEffect, useRef } from "react";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import { logClient, refreshVisibleServers } from "@/lib/tauri";

/**
 * Master-list cadence: new/returning servers appear without a relaunch. A
 * full pass is a dozen Steam requests and takes ~15 minutes (it walks every
 * shard of the browser, not just the populated slice), so ticking faster than
 * that just means the backend no-ops on `discovery_running`.
 */
const REDISCOVER_MS = 30 * 60 * 1000;

export function useRefreshLoops({
  steamConnected,
  runInitialLoad,
  setError,
  setRefreshing,
  setRefreshedAt,
}: {
  steamConnected: boolean;
  runInitialLoad: () => Promise<void>;
  setError: (value: string | null) => void;
  setRefreshing: (value: boolean) => void;
  setRefreshedAt: (value: string) => void;
}) {
  const triggerReload = useServerStore((s) => s.triggerReload);
  const autoRefreshSecs = useSettingsStore((s) => s.autoRefreshIntervalSecs);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  // Guards against overlapping manual/auto-refresh runs.
  const refreshInFlight = useRef(false);

  // Re-probes every server in the current filtered list (distinct from
  // DISCOVER, which pulls new servers in). Only a refresh the player asked for
  // touches the banner; a timed one must not hide or replace what it shows.
  const runRefresh = useCallback(async (manual: boolean) => {
    if (!steamConnected) return;
    if (refreshInFlight.current) return;
    // An A2S refresh opens thousands of UDP sockets; don't run it against a
    // download the user is waiting on.
    if (useServerStore.getState().downloadsActive) {
      if (manual) setError("Paused while mods are downloading — try again once they finish.");
      return;
    }
    const { servers } = useServerStore.getState();
    if (servers.length === 0) return;
    // Only the rows loaded so far; pages not yet read have no address to send.
    const targets = servers
      .filter((s) => s !== undefined)
      .map((s) => ({
        addr: s.addr,
        query_port: s.query_port,
      }));

    refreshInFlight.current = true;
    setRefreshing(true);
    if (manual) setError(null);
    try {
      await refreshVisibleServers(targets, "visible");
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch (e) {
      if (manual) setError(String(e));
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [steamConnected, triggerReload, setError, setRefreshing, setRefreshedAt]);
  const handleRefresh = useCallback(() => runRefresh(true), [runRefresh]);

  // Auto-refresh on a timer, with the same guards as a manual refresh.
  useEffect(() => {
    if (!settingsLoaded || autoRefreshSecs <= 0 || !steamConnected) return;
    const id = window.setInterval(() => {
      // Nothing worth re-querying while hidden in the tray.
      if (document.hidden) return;
      void runRefresh(false);
    }, autoRefreshSecs * 1000);
    return () => clearInterval(id);
  }, [settingsLoaded, autoRefreshSecs, steamConnected, runRefresh]);

  // First *populated* load triggers one immediate sweep, so a fresh launch
  // never shows a screenful of "—" pings waiting for the first interval
  // tick. `hasLoadedOnce` alone is not enough: on an empty registry the
  // first load completes with zero rows, so this retries on every store
  // change until rows exist. The interval effect above owns every later sweep.
  const sweptOnce = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || autoRefreshSecs <= 0 || !steamConnected) return;
    const trySweep = () => {
      if (sweptOnce.current) return;
      const { hasLoadedOnce, servers } = useServerStore.getState();
      if (!hasLoadedOnce || servers.length === 0) return;
      sweptOnce.current = true;
      void runRefresh(false);
    };
    trySweep();
    return useServerStore.subscribe(trySweep);
  }, [settingsLoaded, autoRefreshSecs, steamConnected, runRefresh]);

  // Periodic master re-pull. Discovery was launch-only, so servers still
  // propagating to Steam at startup stayed absent for the whole session —
  // this keeps a long-lived (or trayed) launcher's list growing. Reuses the
  // startup pass for its status line, throttled reloads and logs; a tick that
  // lands mid-discovery is a backend no-op (discovery_running), and the
  // heavier A2S auto-refresh above is untouched.
  useEffect(() => {
    if (!steamConnected) return;
    const id = window.setInterval(() => {
      void logClient("discovery", "periodic rediscover: start");
      void runInitialLoad();
    }, REDISCOVER_MS);
    return () => clearInterval(id);
  }, [steamConnected, runInitialLoad]);

  return { handleRefresh };
}
