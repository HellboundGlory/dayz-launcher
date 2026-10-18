import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { useServerStore } from "@/stores/server-store";
import {
  getServerCounts,
  getServersByAddr,
  logClient,
  registryDegraded,
  serverListSource,
  type ListSource,
  type ModsPendingEntry,
} from "@/lib/tauri";
import { refreshTargets } from "./use-refresh-loops";

/** Debounce window for coalescing backend refresh events into one reload. */
const RELOAD_THROTTLE_MS = 250;

// Longer throttle while discovery is streaming — discovery-progress fires
// several times a second and each reload re-queries the whole table.
// That read covers ~40k rows, so a tighter cadence just queues reads back to
// back for the whole pass.
const DISCOVERY_RELOAD_THROTTLE_MS = 5000;

export function useBackendEvents({
  discovering,
  revealDone,
  onDiscoveryProgress,
  registryReadyHandled,
  setError,
  setRefreshing,
  setRefreshedAt,
}: {
  discovering: boolean;
  revealDone: RefObject<boolean>;
  onDiscoveryProgress: (found: number) => void;
  registryReadyHandled: RefObject<boolean>;
  setError: (value: string | null) => void;
  setRefreshing: (value: boolean) => void;
  setRefreshedAt: (value: string) => void;
}) {
  const triggerReload = useServerStore((s) => s.triggerReload);
  const [counts, setCounts] = useState({ total: 0, populated: 0 });
  // Lets scheduleReload read `discovering` without depending on it.
  const discoveringRef = useRef(false);
  useEffect(() => {
    discoveringRef.current = discovering;
  }, [discovering]);

  /** Registry fell back to in-memory: nothing the user saves will survive. */
  const [storageDegraded, setStorageDegraded] = useState(false);
  /** Which source served the loaded list; `null` until a pass finishes. */
  const [listSource, setListSource] = useState<ListSource | null>(null);

  useEffect(() => {
    registryDegraded()
      .then(setStorageDegraded)
      .catch(() => {});
    // Covers a remount mid-session; a fresh launch has no source yet.
    serverListSource()
      .then(setListSource)
      .catch(() => {});
  }, []);

  // Coalesces backend refresh events into one throttled reload instead of
  // re-querying on every single one.
  const reloadTimer = useRef<number | null>(null);
  /** Last "found" count logged from `discovery-progress`, to keep the log thin. */
  const discoveryLogFloor = useRef(0);
  // Runs `task` once after `delay`; a call while one is pending is dropped.
  const scheduleOnce = useCallback((delay: number, task: () => void) => {
    if (reloadTimer.current !== null) return;
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      task();
    }, delay);
  }, []);
  const refreshCounts = useCallback(() => {
    getServerCounts()
      .then((next) =>
        setCounts((prev) =>
          prev.total === next.total && prev.populated === next.populated
            ? prev
            : next,
        ),
      )
      .catch(() => {});
  }, []);
  const scheduleReload = useCallback(() => {
    const delay = discoveringRef.current
      ? DISCOVERY_RELOAD_THROTTLE_MS
      : RELOAD_THROTTLE_MS;
    scheduleOnce(delay, () => {
      void logClient("reload", "scheduleReload: dispatching reload", true);
      triggerReload();
      setRefreshedAt(new Date().toLocaleTimeString());
      refreshCounts();
    });
  }, [scheduleOnce, triggerReload, setRefreshedAt, refreshCounts]);
  // During a sweep, re-read the rows on screen in place; the sweep's end does the one reload.
  const patchVisibleRows = useCallback(() => {
    const { servers, visibleRange } = useServerStore.getState();
    const addrs = refreshTargets(servers, visibleRange).map((s) => s.addr);
    void getServersByAddr(addrs)
      .then((rows) => useServerStore.getState().patchServers(rows))
      .catch(() => {});
  }, []);
  const schedulePatch = useCallback(
    () => scheduleOnce(RELOAD_THROTTLE_MS, patchVisibleRows),
    [scheduleOnce, patchVisibleRows],
  );

  useEffect(
    () => () => {
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
    },
    [],
  );

  // One-shot retry once the backend confirms its registry is actually open —
  // startup's own queries can otherwise race ahead of it.
  useEffect(() => {
    const unlistenRegistryReady = listen<{ degraded: boolean }>(
      "registry-ready",
      (event) => {
        if (registryReadyHandled.current) return;
        registryReadyHandled.current = true;
        // A load that failed before the registry opened says nothing; the reload below decides.
        useServerStore.getState().setLoadError(null);
        void logClient(
          "startup",
          `registry-ready received (degraded=${event.payload.degraded}) -> scheduleReload`,
        );
        scheduleReload();
      },
    );
    return () => {
      unlistenRegistryReady.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<{
      tier: number;
      requests: number;
      found: number;
    }>("discovery-progress", (event) => {
      onDiscoveryProgress(event.payload.found);
      // Log a thin sample (first + every 1000) — the full event stream
      // during discovery would otherwise be the whole log.
      if (
        discoveryLogFloor.current === 0 ||
        event.payload.found - discoveryLogFloor.current >= 1000
      ) {
        discoveryLogFloor.current = event.payload.found;
        void logClient(
          "discovery",
          `discovery-progress: found ${event.payload.found}`,
        );
      }
      scheduleReload();
    });

    const unlistenRefreshed = listen("server-refreshed", () => {
      if (useServerStore.getState().refreshActive) schedulePatch();
      else scheduleReload();
    });

    const unlistenSource = listen<{ source: ListSource; servers: number; ms: number }>(
      "discovery-source",
      (event) => {
        setListSource(event.payload.source);
        void logClient(
          "discovery",
          `discovery-source: ${event.payload.servers} servers from ${event.payload.source} in ${event.payload.ms}ms`,
        );
      },
    );

    const unlistenModsPending = listen<ModsPendingEntry[]>(
      "mods-pending",
      (event) => {
        useServerStore.getState().mergeModPending(event.payload);
      },
    );

    // Steam stops answering server-list requests after a per-process
    // allowance, so rediscovery can only silently do nothing until restart.
    // Say so rather than leaving a stale list looking current.
    const unlistenExhausted = listen("discovery-exhausted", () => {
      setError(
        "Steam won't send any more of the server list until Tetra is restarted. " +
          "The list below is the last full pass — restart to refresh it.",
      );
    });

    // Completion is the one event that reloads immediately rather than on the
    // throttle, so the final state is never left a beat behind.
    const unlistenComplete = listen<{
      ok: number;
      failed: number;
      scope?: string;
    }>("refresh-complete", (event) => {
      // A sweep reloads once when it ends (runRefresh); a row refresh reloads here.
      if (!useServerStore.getState().refreshActive) triggerReload();
      refreshCounts();
      // But only a full pass owns the spinner and the timestamp. A row
      // refresh finishing mid-pass would otherwise report the whole refresh
      // as done and stamp a time nothing had reached.
      if (event.payload?.scope === "row") return;
      setRefreshing(false);
      setRefreshedAt(new Date().toLocaleTimeString());
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenRefreshed.then((fn) => fn());
      unlistenSource.then((fn) => fn());
      unlistenModsPending.then((fn) => fn());
      unlistenExhausted.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety net: some Windows/WebView2 setups stall reloads while the window
  // is hidden, so force one the first time it becomes visible. Scoped to
  // `revealDone` so alt-tabbing back from DayZ doesn't retrigger it.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (revealDone.current) return;
      void logClient(
        "reload",
        "window became visible -> scheduleReload (safety net)",
      );
      scheduleReload();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [scheduleReload, revealDone]);

  return { counts, listSource, storageDegraded };
}
