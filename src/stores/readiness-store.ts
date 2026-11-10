import { create } from "zustand";
import { serverModReadiness } from "@/lib/tauri";
import type { ServerModReadiness } from "@/types/server";

type CacheEntry = { readiness: ServerModReadiness } | { error: true; at: number; failures: number };

const DEBOUNCE_MS = 250;
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 300_000;

/** How long a failed fetch stands before a request for that server tries again: doubles per failure, capped. */
export function retryDelayMs(failures: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_CAP_MS);
}

interface ReadinessState {
  cache: Map<string, CacheEntry>;
  /** Bumped on every change, so consumers re-read through `useSyncExternalStore`. */
  version: number;
}

const useReadinessStore = create<ReadinessState>(() => ({ cache: new Map(), version: 0 }));

// Requests under way: a consumer arriving during one shares it rather than asking again.
const pending = new Map<string, Promise<void>>();

function store(key: string, entry: CacheEntry): void {
  useReadinessStore.setState((state) => {
    const cache = new Map(state.cache);
    cache.set(key, entry);
    return { cache, version: state.version + 1 };
  });
}

export function readinessKey(addr: string, queryPort: number): string {
  return `${addr}:${queryPort}`;
}

export function getCachedReadiness(addr: string, queryPort: number): CacheEntry | undefined {
  return useReadinessStore.getState().cache.get(readinessKey(addr, queryPort));
}

export function subscribeReadiness(listener: () => void): () => void {
  return useReadinessStore.subscribe(listener);
}

export function getReadinessVersion(): number {
  return useReadinessStore.getState().version;
}

/** Records a readiness result fetched elsewhere, e.g. by Check mods. */
export function setCachedReadiness(addr: string, queryPort: number, readiness: ServerModReadiness): void {
  const key = readinessKey(addr, queryPort);
  pending.delete(key);
  store(key, { readiness });
}

/** Drops every cached result and forgets any request that started before this point. */
export function invalidateReadiness(): void {
  pending.clear();
  useReadinessStore.setState((state) => ({ cache: new Map(), version: state.version + 1 }));
}

/** A cached result, or a failure recent enough not to retry yet. */
function hasResult(key: string): boolean {
  const entry = useReadinessStore.getState().cache.get(key);
  if (entry === undefined) return false;
  return !("error" in entry) || Date.now() - entry.at < retryDelayMs(entry.failures);
}

function fetchReadiness(key: string, addr: string, queryPort: number): void {
  if (pending.has(key) || hasResult(key)) return;

  const request = serverModReadiness(addr, queryPort)
    .then((result) => {
      if (pending.get(key) !== request) return;
      store(key, { readiness: result });
    })
    .catch(() => {
      if (pending.get(key) !== request) return;
      const previous = useReadinessStore.getState().cache.get(key);
      const failures = previous && "error" in previous ? previous.failures + 1 : 1;
      store(key, { error: true, at: Date.now(), failures });
      // Wakes consumers once the wait is over, so a server left open retries.
      setTimeout(() => {
        useReadinessStore.setState((state) => ({ version: state.version + 1 }));
      }, retryDelayMs(failures));
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  pending.set(key, request);
}

/** Debounces one fetch for a server; consumers arriving during it share its request. */
export function scheduleReadinessFetch(addr: string, queryPort: number): () => void {
  const key = readinessKey(addr, queryPort);
  if (hasResult(key)) return () => {};
  const timer = setTimeout(() => {
    fetchReadiness(key, addr, queryPort);
  }, DEBOUNCE_MS);
  return () => clearTimeout(timer);
}
