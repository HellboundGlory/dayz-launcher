import { useEffect, useSyncExternalStore } from "react";
import { useServerStore } from "@/stores/server-store";
import { getCachedReadiness, getReadinessVersion, scheduleReadinessFetch, subscribeReadiness } from "@/stores/readiness-store";
import type { ServerModReadiness } from "@/types/server";

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
  const version = useSyncExternalStore(subscribeReadiness, getReadinessVersion, getReadinessVersion);

  useEffect(() => {
    if (addr === null || queryPort === null) return;
    return scheduleReadinessFetch(addr, queryPort);
  }, [addr, queryPort, version]);

  if (addr === null || queryPort === null) return { readiness: null, loading: false };

  const entry = getCachedReadiness(addr, queryPort);
  if (!entry) return { readiness: null, loading: true };
  if ("error" in entry) return { readiness: null, loading: false };
  return { readiness: entry.readiness, loading: false };
}
