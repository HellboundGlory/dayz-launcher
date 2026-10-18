import { useCallback, useEffect, useRef } from "react";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import { logClient, refreshVisibleServers } from "@/lib/tauri";
import type { Server } from "@/types/server";

/**
 * Master-list cadence: new/returning servers appear without a relaunch. A
 * full pass is a dozen Steam requests and takes ~15 minutes (it walks every
 * shard of the browser, not just the populated slice), so ticking faster than
 * that just means the backend no-ops on `discovery_running`.
 */
const REDISCOVER_MS = 30 * 60 * 1000;

/** The loaded rows on screen plus one screen above and below, in list order. */
export function refreshTargets(
  servers: (Server | undefined)[],
  range: { start: number; end: number },
  cap = 1000,
): Server[] {
  const span = range.end - range.start + 1;
  const first = Math.max(0, range.start - span);
  const last = Math.min(servers.length - 1, range.end + span);
  const targets: Server[] = [];
  for (let i = first; i <= last && targets.length < cap; i++) {
    const server = servers[i];
    if (server) targets.push(server);
  }
  return targets;
}

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
  const setRefreshActive = useServerStore((s) => s.setRefreshActive);
  const autoRefreshSecs = useSettingsStore((s) => s.autoRefreshIntervalSecs);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  // Guards against overlapping manual/auto-refresh runs.
  const refreshInFlight = useRef(false);
  // A manual click made during a timed run starts once that run ends.
  const queuedManual = useRef(false);

  // Re-probes the rows on screen and one screen either side (distinct from
  // DISCOVER, which pulls new servers in). Only a refresh the player asked for
  // touches the banner and the button; a timed one must not hide or replace what it shows.
  const runRefresh = useCallback(async (manual: boolean) => {
    if (!steamConnected) return;
    if (refreshInFlight.current) {
      if (manual) queuedManual.current = true;
      return;
    }
    // An A2S refresh opens thousands of UDP sockets; don't run it against a
    // download the user is waiting on.
    if (useServerStore.getState().downloadsActive) {
      if (manual) setError("Paused while mods are downloading — try again once they finish.");
      return;
    }
    const { servers, visibleRange } = useServerStore.getState();
    if (servers.length === 0) return;
    const targets = refreshTargets(servers, visibleRange).map((s) => ({
      addr: s.addr,
      query_port: s.query_port,
    }));

    refreshInFlight.current = true;
    setRefreshActive(true);
    if (manual) {
      setRefreshing(true);
      setError(null);
    }
    try {
      await refreshVisibleServers(targets, "visible");
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch (e) {
      if (manual) setError(String(e));
    } finally {
      refreshInFlight.current = false;
      setRefreshActive(false);
      triggerReload();
      if (manual) setRefreshing(false);
      if (queuedManual.current) {
        queuedManual.current = false;
        void runRefresh(true);
      }
    }
  }, [steamConnected, triggerReload, setRefreshActive, setError, setRefreshing, setRefreshedAt]);
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
