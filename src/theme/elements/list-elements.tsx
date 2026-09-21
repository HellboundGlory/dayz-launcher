import { useRef, type CSSProperties } from "react";
import { useServerStore } from "@/stores/server-store";
import type { SortKey } from "@/types/filters";
import { ListHost } from "../lists/list-host";
import { ListRow } from "../lists/list-row";
import { getActiveLayout } from "../theme-store";
import { SERVERS_LIST } from "../neutral";
import { serverModReadiness } from "@/lib/tauri";
import { useSelectionReadiness } from "./use-selection-readiness";
import type { Server, ModReadinessEntry, ServerModReadiness } from "@/types/server";
import type { LayoutFile } from "../renderer/types";

export function ServerListHost({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const servers = useServerStore((s) => s.servers);
  const selectedServer = useServerStore((s) => s.selectedServer);
  const setSelectedServer = useServerStore((s) => s.setSelectedServer);
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const setSort = useServerStore((s) => s.setSort);

  const listLayout = (getActiveLayout("layout/lists/servers.json") ?? SERVERS_LIST) as LayoutFile;

  return (
    <div data-el="list.servers" className={className ?? "flex-1 min-h-0 w-full"} style={style}>
      <ListHost<Server>
        listId="list.servers"
        items={servers}
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
  listLayout,
  className,
  style,
}: {
  state: ServerModsListState;
  mods: ModReadinessEntry[];
  listLayout?: LayoutFile;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-el="list.serverMods"
      data-list="serverMods"
      data-state={state}
      className={className ?? "flex flex-col flex-1 min-h-0 my-2 border-t border-border overflow-hidden"}
      style={style}
    >
      <div data-part="header" className="flex items-center justify-between py-1.5 px-2 text-[10px] text-muted font-bold tracking-wider uppercase border-b border-border">
        <span>REQUIRED MODS · SERVER ORDER</span>
        <span className="font-mono-data">{mods.length}</span>
      </div>

      <div data-part="scroller" className="flex-1 overflow-y-auto min-h-0">
        {state === "loading" ? (
          <div data-part="loading" className="p-4 text-xs text-muted">Loading…</div>
        ) : mods.length === 0 ? (
          <div data-part="empty" className="p-4 text-xs text-muted">This server declares no mods.</div>
        ) : (
          <div data-part="rows">
            {mods.map((mod) => (
              <ListRow
                key={mod.workshop_id || mod.name}
                rowNode={listLayout?.row}
                item={mod}
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
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const selectedServer = useServerStore((s) => s.selectedServer);
  const { readiness, loading } = useSelectionReadiness();
  const lastModsRef = useRef<ModReadinessEntry[]>([]);

  const { state, mods } = resolveModsListDisplay(selectedServer, loading, readiness, lastModsRef.current);
  const isFreshResult = !!selectedServer?.modded && !loading && readiness !== null && !readiness.stale;
  if (isFreshResult) {
    lastModsRef.current = mods;
  }

  const listLayout = getActiveLayout("layout/lists/serverMods.json") as LayoutFile | undefined;

  return (
    <ServerModsList state={state} mods={mods} listLayout={listLayout} className={className} style={style} />
  );
}
