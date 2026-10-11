import { useMemo, useRef, type CSSProperties } from "react";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useServerStore } from "@/stores/server-store";
import { useModsStore, effectiveModState, filterAndSortMods, type ModSortKey } from "@/stores/mods-store";
import {
  useModFilterStore,
  subscribedForDayz,
  activeEntries,
  type ModFilterEntry,
} from "@/stores/mod-filter-store";
import type { SortKey } from "@/types/filters";
import { ListHost } from "../lists/list-host";
import { ListRow } from "../lists/list-row";
import { getActiveLayout, useLayoutSubscription } from "../theme-store";
import { SERVERS_LIST, MODS_LIST, MOD_SERVERS_LIST, MOD_FILTER_RESULTS_LIST, SERVER_MODS_LIST } from "../neutral";
import { serverModReadiness, type ModState, type SubscribedMod } from "@/lib/tauri";
import { useSelectionReadiness } from "./use-selection-readiness";
import { readinessKey } from "@/stores/readiness-store";
import { useServerSubject } from "./server-elements";
import type { Server, ModReadinessEntry, ServerModReadiness } from "@/types/server";
import type { LayoutFile } from "../renderer/types";

// Only the options a list's registry entry declares reach the host.
function listHostOptions(options: Record<string, unknown> | undefined) {
  return {
    header: options?.header !== false,
    rowGap: typeof options?.rowGap === "string" ? options.rowGap : undefined,
  };
}

export function ServerListHost({
  className,
  style,
  options,
}: {
  className?: string;
  style?: CSSProperties;
  options?: Record<string, unknown>;
}) {
  const servers = useServerStore((s) => s.servers);
  const selectedServer = useServerStore((s) => s.selectedServer);
  const setSelectedServer = useServerStore((s) => s.setSelectedServer);
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const setSort = useServerStore((s) => s.setSort);
  const hasLoadedOnce = useServerStore((s) => s.hasLoadedOnce);

  useLayoutSubscription();
  const listLayout = (getActiveLayout("layout/lists/servers.json") ?? SERVERS_LIST) as LayoutFile;
  return (
    <div data-el="list.servers" data-state={servers.length === 0 ? "empty" : undefined} className={className ?? "flex-1 min-h-0 w-full"} style={style}>
      <ListHost<Server>
        listId="list.servers"
        items={servers}
        emptyText={
          hasLoadedOnce
            ? "No servers match the current filters."
            : "No servers yet — the list fills in once Steam connects."
        }
        {...listHostOptions(options)}
        columns={listLayout?.columns}
        rowNode={listLayout?.row}
        overflowX={listLayout?.overflowX}
        selectedItem={selectedServer}
        onSelect={(server) =>
          setSelectedServer(server && selectedServer && server.addr === selectedServer.addr ? null : server)
        }
        sortState={{
          key: sortKey,
          direction: sortDir === "asc" ? "ascending" : "descending",
        }}
        onSortChange={(key) =>
          setSort(key as SortKey, sortKey === key && sortDir === "desc" ? "asc" : "desc")
        }
        computeRowStates={(server, isSelected) =>
          [
            isSelected ? "selected" : "",
            !server.online ? "offline" : "",
            server.favourite ? "favourite" : "",
          ].filter(Boolean)
        }
        estimatedRowHeight={listLayout?.estimatedRowHeight ?? 40}
      />
    </div>
  );
}

export type ServerModsListState = "loading" | "empty" | "stale" | undefined;

/** Resolves the readiness fetch for one selection. A rejection is reported as `stale`, never as invented mods. */
export async function loadServerMods(
  server: Pick<Server, "addr" | "query_port" | "modded"> | null,
): Promise<{ state: ServerModsListState; mods: ModReadinessEntry[] }> {
  if (!server || !server.modded) {
    return { state: "empty", mods: [] };
  }
  try {
    const res = await serverModReadiness(server.addr, server.query_port);
    // SPEC 11.2: an offline server keeps its last known list, marked stale.
    const state = res.stale ? "stale" : res.mods.length > 0 ? undefined : "empty";
    return { state, mods: res.mods };
  } catch {
    return { state: "stale", mods: [] };
  }
}

export function ServerModsList({
  state,
  mods,
  modded,
  header = true,
  listLayout,
  className,
  style,
}: {
  state: ServerModsListState;
  mods: ModReadinessEntry[];
  modded: boolean;
  header?: boolean;
  listLayout?: LayoutFile;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-el="list.serverMods"
      data-list="serverMods"
      data-state={state}
      className={className ?? "flex flex-col flex-1 min-h-0 my-2 border-t border-line overflow-hidden"}
      style={style}
    >
      {header && (
        <div data-part="header" className="flex items-center justify-between py-1.5 px-2 text-[10px] text-muted font-bold tracking-wider uppercase border-b border-line">
          <span>REQUIRED MODS · SERVER ORDER</span>
          <span className="font-mono-data">{mods.length}</span>
        </div>
      )}

      <div data-part="scroller" className="flex-1 overflow-y-auto min-h-0">
        {state === "loading" ? (
          <div data-part="loading" className="flex items-center justify-center gap-1.5 p-4 text-xs text-muted">
            <LoaderCircle className="size-3.5 animate-spin" />
            Checking mod readiness…
          </div>
        ) : mods.length === 0 ? (
          <div data-part="empty" className="p-4 text-xs text-muted">
            {modded ? "No mods found or not probed yet." : "No mods required."}
          </div>
        ) : (
          <div data-part="rows">
            {mods.map((mod, index) => (
              <ListRow
                key={mod.workshop_id || mod.name}
                rowNode={listLayout?.row}
                item={{ ...mod, order: index + 1 }}
                subjectKind="serverMod"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pure mapping from selection + readiness to what `ServerModsList` should render. */
export function resolveModsListDisplay(
  server: Pick<Server, "modded"> | null,
  loading: boolean,
  readiness: ServerModReadiness | null,
  lastMods: ModReadinessEntry[],
): { state: ServerModsListState; mods: ModReadinessEntry[] } {
  if (!server || !server.modded) {
    return { state: "empty", mods: [] };
  }
  if (loading) {
    return { state: "loading", mods: [] };
  }
  if (readiness === null || readiness.stale) {
    // Keep whatever list is already on screen; only flag it as possibly out of date.
    return { state: "stale", mods: lastMods };
  }
  return readiness.mods.length > 0
    ? { state: undefined, mods: readiness.mods }
    : { state: "empty", mods: [] };
}

export function ServerModsListHost({
  className,
  style,
  options,
}: {
  className?: string;
  style?: CSSProperties;
  options?: Record<string, unknown>;
}) {
  const server = useServerSubject();
  const { readiness, loading } = useSelectionReadiness(server);
  const lastRef = useRef<{ key: string | null; mods: ModReadinessEntry[] }>({ key: null, mods: [] });
  const key = server ? readinessKey(server.addr, server.query_port) : null;

  const lastMods = lastRef.current.key === key ? lastRef.current.mods : [];
  const { state, mods } = resolveModsListDisplay(server, loading, readiness, lastMods);
  const isFreshResult = !!server?.modded && !loading && readiness !== null && !readiness.stale;
  if (isFreshResult) {
    lastRef.current = { key, mods };
  }

  useLayoutSubscription();
  const listLayout = (getActiveLayout("layout/lists/serverMods.json") ?? SERVER_MODS_LIST) as LayoutFile;

  return (
    <ServerModsList
      state={state}
      mods={mods}
      modded={!!server?.modded}
      header={listHostOptions(options).header}
      listLayout={listLayout}
      className={className}
      style={style}
    />
  );
}

export function ModServersListHost({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const needing = useModsStore((s) => s.needing);
  useLayoutSubscription();
  const listLayout = (getActiveLayout("layout/lists/modServers.json") ?? MOD_SERVERS_LIST) as LayoutFile;

  const items = needing.slice(0, 8);
  const more = needing.length - items.length;

  return (
    <div
      data-el="list.modServers"
      data-list="modServers"
      data-state={needing.length === 0 ? "empty" : undefined}
      className={className ?? "flex flex-col gap-0.5"}
      style={style}
    >
      <div data-part="rows">
        {items.map((srv) => (
          <ListRow
            key={`${srv.addr}:${srv.query_port}`}
            rowNode={listLayout?.row}
            item={srv}
            subjectKind="modServer"
            states={[srv.last_played != null ? "played" : ""].filter(Boolean)}
          />
        ))}
      </div>
      {more > 0 && (
        <span data-part="more" className="text-muted">
          +{more} more
        </span>
      )}
    </div>
  );
}

export const MOD_STATE_NAME: Record<ModState, string> = {
  ready: "ready",
  needs_update: "update",
  downloading: "downloading",
  not_installed: "missing",
  not_subscribed: "notSubscribed",
  not_on_workshop: "serverSide",
};

export function ModsListHost({
  className,
  style,
  options,
}: {
  className?: string;
  style?: CSSProperties;
  options?: Record<string, unknown>;
}) {
  const { rows, search, statusFilter, sortKey, sortDir, states, selectedModId, selectedIds, openMod, setSort, loading } =
    useModsStore(
      useShallow((s) => ({
        rows: s.rows,
        search: s.search,
        statusFilter: s.statusFilter,
        sortKey: s.sortKey,
        sortDir: s.sortDir,
        states: s.states,
        selectedModId: s.selectedModId,
        selectedIds: s.selectedIds,
        openMod: s.openMod,
        setSort: s.setSort,
        loading: s.loading,
      })),
    );

  const mods = useMemo(
    () => filterAndSortMods(rows, { search, statusFilter, sortKey, sortDir, states }),
    [rows, states, search, statusFilter, sortKey, sortDir],
  );

  const selectedMod = mods.find((m) => m.workshop_id === selectedModId) ?? null;
  useLayoutSubscription();
  const listLayout = (getActiveLayout("layout/lists/mods.json") ?? MODS_LIST) as LayoutFile;
  const filtered = !!search || statusFilter !== "all";
  const listState = mods.length === 0 ? (loading ? "loading" : filtered ? "empty filtered" : "empty") : undefined;

  return (
    <div data-el="list.mods" data-state={listState} className={className ?? "flex-1 min-h-0 w-full"} style={style}>
      <ListHost<SubscribedMod>
        listId="list.mods"
        items={mods}
        loading={loading}
        loadingText="Loading subscribed mods…"
        emptyText={filtered ? "No mods match the current filter." : "You have no subscribed DayZ Workshop mods."}
        {...listHostOptions(options)}
        columns={listLayout?.columns}
        rowNode={listLayout?.row}
        overflowX={listLayout?.overflowX}
        selectedItem={selectedMod}
        onSelect={(mod) =>
          openMod(mod && mod.workshop_id === selectedModId ? null : (mod?.workshop_id ?? null))
        }
        sortState={{
          key: sortKey,
          direction: sortDir === "asc" ? "ascending" : "descending",
        }}
        onSortChange={(key) => setSort(key as ModSortKey)}
        computeRowStates={(mod, isSelected) =>
          [
            isSelected ? "selected" : "",
            selectedIds.has(mod.workshop_id) ? "checked" : "",
            mod.locally_disabled ? "disabled" : "",
            MOD_STATE_NAME[effectiveModState(mod.state, states[mod.workshop_id])],
          ].filter(Boolean)
        }
        estimatedRowHeight={listLayout?.estimatedRowHeight ?? 54}
      />
    </div>
  );
}

function modFilterResultsEmptyText(loading: boolean, tab: string, query: string): string {
  if (loading) return "Loading…";
  if (tab === "workshop" && !query.trim()) return "Type a mod name above to search the Workshop.";
  if (tab === "subscribed") return "No subscribed DayZ mods.";
  return "No mods match.";
}

export function ModFilterResultsListHost({
  className,
  style,
  options,
}: {
  className?: string;
  style?: CSSProperties;
  options?: Record<string, unknown>;
}) {
  const modsRows = useModsStore((s) => s.rows);
  const modsLoading = useModsStore((s) => s.loading);
  const { tab, query, selection, previewId, known, knownLoading, searchResults, searchLoading, usage, setPreviewId } =
    useModFilterStore(
      useShallow((s) => ({
        tab: s.tab,
        query: s.query,
        selection: s.selection,
        previewId: s.previewId,
        known: s.known,
        knownLoading: s.knownLoading,
        searchResults: s.searchResults,
        searchLoading: s.searchLoading,
        usage: s.usage,
        setPreviewId: s.setPreviewId,
      })),
    );

  const subscribedRows = useMemo(() => subscribedForDayz(modsRows), [modsRows]);
  const items = useMemo(
    () => activeEntries({ tab, query, subscribedRows, known, searchResults, usage }),
    [tab, query, subscribedRows, known, searchResults, usage],
  );

  const loading =
    (tab === "subscribed" && modsLoading && subscribedRows.length === 0) ||
    (tab === "seen" && knownLoading) ||
    (tab === "workshop" && searchLoading);

  const listState: "empty" | "loading" | "searching" | undefined = loading
    ? tab === "workshop"
      ? "searching"
      : "loading"
    : items.length === 0
      ? "empty"
      : undefined;

  const selectedItem = items.find((e) => e.id === previewId) ?? null;
  useLayoutSubscription();
  const listLayout = (getActiveLayout("layout/lists/modFilterResults.json") ?? MOD_FILTER_RESULTS_LIST) as LayoutFile;

  return (
    <div data-el="list.modFilterResults" data-state={listState} className={className ?? "flex-1 min-h-0 w-full"} style={style}>
      <ListHost<ModFilterEntry>
        listId="list.modFilterResults"
        items={loading ? [] : items}
        {...listHostOptions(options)}
        columns={listLayout?.columns}
        rowNode={listLayout?.row}
        emptyNode={{ type: "text", value: modFilterResultsEmptyText(loading, tab, query) }}
        overflowX={listLayout?.overflowX}
        selectedItem={selectedItem}
        onSelect={(entry) => setPreviewId(entry ? entry.id : null)}
        computeRowStates={(entry) =>
          [
            entry.id === previewId ? "previewed" : "",
            selection[entry.id] === "include" ? "included" : "",
            selection[entry.id] === "exclude" ? "excluded" : "",
            entry.subscribed ? "subscribed" : "",
          ].filter(Boolean)
        }
        estimatedRowHeight={listLayout?.estimatedRowHeight ?? 44}
      />
    </div>
  );
}
