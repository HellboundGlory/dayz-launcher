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

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function readinessKey(addr: string, queryPort: number): string {
  return `${addr}:${queryPort}`;
}

export function getCachedReadiness(addr: string, queryPort: number): CacheEntry | undefined {
  return cache.get(readinessKey(addr, queryPort));
}

export function subscribeReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReadinessVersion(): number {
  return version;
}

/** Records a readiness result fetched elsewhere, e.g. by Check mods. */
export function setCachedReadiness(addr: string, queryPort: number, readiness: ServerModReadiness): void {
  const key = readinessKey(addr, queryPort);
  pending.delete(key);
  cache.set(key, { readiness });
  notify();
}

/** Drops every cached result and forgets any request that started before this point. */
export function invalidateReadiness(): void {
  cache.clear();
  pending.clear();
  notify();
}

/** A cached result, or a failure recent enough not to retry yet. */
function hasResult(key: string): boolean {
  const entry = cache.get(key);
  if (entry === undefined) return false;
  return !("error" in entry) || Date.now() - entry.at < retryDelayMs(entry.failures);
}

function fetchReadiness(key: string, addr: string, queryPort: number): void {
  if (pending.has(key) || hasResult(key)) return;

  const request = serverModReadiness(addr, queryPort)
    .then((result) => {
      if (pending.get(key) !== request) return;
      cache.set(key, { readiness: result });
      notify();
    })
    .catch(() => {
      if (pending.get(key) !== request) return;
      const previous = cache.get(key);
      const failures = previous && "error" in previous ? previous.failures + 1 : 1;
      cache.set(key, { error: true, at: Date.now(), failures });
      notify();
      // Wakes consumers once the wait is over, so a server left open retries.
      setTimeout(notify, retryDelayMs(failures));
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
