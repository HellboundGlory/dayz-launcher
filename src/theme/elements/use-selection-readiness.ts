import { useEffect, useSyncExternalStore } from "react";
import { getCachedReadiness, getReadinessVersion, scheduleReadinessFetch, subscribeReadiness } from "@/stores/readiness-store";
import type { Server, ServerModReadiness } from "@/types/server";
import { useElementContext } from "./context";
import { usePopupContext } from "./popup-elements";

export interface SelectionReadiness {
  readiness: ServerModReadiness | null;
  loading: boolean;
}

/**
 * Mod readiness for `server`, the server the element is drawn for. Rows get
 * none, since a fetch per row would break the no-per-row Steam fetch rule; a
 * popup opened from a row does. `loading` tells an in-flight fetch from a
 * resolved empty/error result.
 */
export function useSelectionReadiness(server: Server | null): SelectionReadiness {
  const { contextName } = useElementContext();
  const { popupId } = usePopupContext();
  const target = contextName === "row" && !popupId ? null : server;
  const addr = target?.addr ?? null;
  const queryPort = target?.query_port ?? null;
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
