import { useEffect, useReducer } from "react";
import { useServerStore } from "@/stores/server-store";
import { serverModReadiness } from "@/lib/tauri";
import type { ServerModReadiness } from "@/types/server";

const SELECTION_DEBOUNCE_MS = 250;

type CacheEntry = { readiness: ServerModReadiness } | { error: true };

/** Per-session cache keyed by server; cleared only by a full reload. */
const cache = new Map<string, CacheEntry>();

export function cacheKey(addr: string, queryPort: number): string {
  return `${addr}:${queryPort}`;
}

export function getCachedReadiness(addr: string, queryPort: number): CacheEntry | undefined {
  return cache.get(cacheKey(addr, queryPort));
}

/** Test-only: the cache is module-level and outlives individual test cases otherwise. */
export function __clearReadinessCacheForTests(): void {
  cache.clear();
}

/** Debounces a fetch for one server, caching the outcome. Returns a cleanup that cancels it. */
export function scheduleReadinessFetch(addr: string, queryPort: number, onSettled: () => void): () => void {
  const key = cacheKey(addr, queryPort);
  if (cache.has(key)) return () => {};

  let cancelled = false;
  const timer = setTimeout(() => {
    serverModReadiness(addr, queryPort)
      .then((result) => cache.set(key, { readiness: result }))
      .catch(() => cache.set(key, { error: true }))
      .finally(() => {
        if (!cancelled) onSettled();
      });
  }, SELECTION_DEBOUNCE_MS);

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export interface SelectionReadiness {
  readiness: ServerModReadiness | null;
  loading: boolean;
}

/**
 * Fetches mod readiness for the current selection only (SPEC §11.2). Never
 * call this per row — it flouts the "no per-row Steam fetch" rule in
 * ELEMENTS.md. `loading` distinguishes an in-flight fetch from a resolved
 * empty/error result, both of which report `readiness: null`.
 */
export function useSelectionReadiness(): SelectionReadiness {
  const selectedServer = useServerStore((s) => s.selectedServer);
  const addr = selectedServer?.addr ?? null;
  const queryPort = selectedServer?.query_port ?? null;

  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (addr === null || queryPort === null) return;
    return scheduleReadinessFetch(addr, queryPort, forceRender);
  }, [addr, queryPort]);

  if (addr === null || queryPort === null) return { readiness: null, loading: false };

  const entry = getCachedReadiness(addr, queryPort);
  if (!entry) return { readiness: null, loading: true };
  if ("error" in entry) return { readiness: null, loading: false };
  return { readiness: entry.readiness, loading: false };
}
