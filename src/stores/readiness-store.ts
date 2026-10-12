import { serverModReadiness } from "@/lib/tauri";
import type { ServerModReadiness } from "@/types/server";

type CacheEntry = { readiness: ServerModReadiness } | { error: true; at: number };

const DEBOUNCE_MS = 250;
/** How long a failed fetch stands before a request for that server tries again. */
const RETRY_AFTER_MS = 30_000;

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
  return !("error" in entry) || Date.now() - entry.at < RETRY_AFTER_MS;
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
      cache.set(key, { error: true, at: Date.now() });
      notify();
      // Wakes consumers once the wait is over, so a server left open retries.
      setTimeout(notify, RETRY_AFTER_MS);
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
