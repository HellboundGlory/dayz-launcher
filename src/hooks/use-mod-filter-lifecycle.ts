import { useEffect, useMemo } from "react";
import { useModsStore } from "@/stores/mods-store";
import { useModFilterStore, subscribedForDayz } from "@/stores/mod-filter-store";
import { getModUsage } from "@/lib/tauri";
import type { SubscribedMod } from "@/lib/tauri";

/** Non-presentational effects the mod filter modal needs regardless of which UI renders it:
    loading subscribed/known mods on open, and merging server-count usage as the source or
    tab changes. Both the legacy modal and the themed path call this. */
export function useModFilterLifecycle(): { subscribedRows: SubscribedMod[] } {
  const modsRows = useModsStore((s) => s.rows);
  const loadSubscribedMods = useModsStore((s) => s.load);
  const tab = useModFilterStore((s) => s.tab);
  const searchResults = useModFilterStore((s) => s.searchResults);
  const usage = useModFilterStore((s) => s.usage);
  const loadKnownMods = useModFilterStore((s) => s.loadKnownMods);
  const mergeUsage = useModFilterStore((s) => s.mergeUsage);

  const subscribedRows = useMemo(() => subscribedForDayz(modsRows), [modsRows]);

  useEffect(() => {
    void loadSubscribedMods();
    void loadKnownMods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ids =
      tab === "subscribed"
        ? subscribedRows.map((m) => m.workshop_id)
        : tab === "workshop"
          ? searchResults.map((m) => m.workshop_id)
          : [];
    const missing = ids.filter((id) => !(id in usage));
    if (missing.length === 0) return;
    let cancelled = false;
    getModUsage(missing).then((rows) => {
      if (cancelled) return;
      mergeUsage(rows);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subscribedRows, searchResults]);

  return { subscribedRows };
}
