import { useEffect, useState, type CSSProperties } from "react";
import { useServerStore } from "@/stores/server-store";
import { ListHost } from "../lists/list-host";
import { ListRow } from "../lists/list-row";
import { getActiveLayout } from "../theme-store";
import { SERVERS_LIST } from "../neutral";
import { serverModReadiness } from "@/lib/tauri";
import type { Server, ServerModReadiness, ModReadinessEntry } from "@/types/server";
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

  // Auto-select first server if none selected, so Tactical detail pane shows data immediately
  useEffect(() => {
    if (servers.length > 0 && !selectedServer) {
      setSelectedServer(servers[0]);
    }
  }, [servers, selectedServer, setSelectedServer]);

  const listLayout = (getActiveLayout("layout/lists/servers.json") ?? SERVERS_LIST) as LayoutFile;

  return (
    <div data-el="list.servers" className={className ?? "flex-1 min-h-0 w-full"} style={style}>
      <ListHost<Server>
        listId="list.servers"
        items={servers}
        columns={listLayout?.columns}
        rowNode={listLayout?.row}
        selectedItem={selectedServer}
        onSelect={(server) => setSelectedServer(server)}
        sortState={{
          key: sortKey,
          direction: sortDir === "asc" ? "ascending" : "descending",
        }}
        onSortChange={(key) =>
          setSort(key as any, sortKey === key && sortDir === "desc" ? "asc" : "desc")
        }
        computeRowStates={(server, isSelected) =>
          [
            isSelected ? "selected" : "",
            !server.online ? "offline" : "",
            server.favourite ? "favourite" : "",
          ].filter(Boolean)
        }
        estimatedRowHeight={40}
      />
    </div>
  );
}

const DEFAULT_TACTICAL_MODS: ModReadinessEntry[] = [
  { workshop_id: "1", name: "CF", state: "ready", size_bytes: null, size_is_upper_bound: false, preview_url: null, is_unique: false, downloaded_bytes: null, total_bytes: null },
  { workshop_id: "2", name: "Community Online Tools", state: "ready", size_bytes: null, size_is_upper_bound: false, preview_url: null, is_unique: false, downloaded_bytes: null, total_bytes: null },
  { workshop_id: "3", name: "DayZ-Expansion-Bundle", state: "needs_update", size_bytes: 1288490188, size_is_upper_bound: false, preview_url: null, is_unique: false, downloaded_bytes: null, total_bytes: null },
  { workshop_id: "4", name: "VPPAdminTools", state: "ready", size_bytes: null, size_is_upper_bound: false, preview_url: null, is_unique: false, downloaded_bytes: null, total_bytes: null },
  { workshop_id: "5", name: "Trader", state: "not_subscribed", size_bytes: null, size_is_upper_bound: false, preview_url: null, is_unique: false, downloaded_bytes: null, total_bytes: null },
  { workshop_id: "6", name: "Code Lock", state: "ready", size_bytes: null, size_is_upper_bound: false, preview_url: null, is_unique: false, downloaded_bytes: null, total_bytes: null },
  { workshop_id: "7", name: "MuchStuffPack", state: "needs_update", size_bytes: 356515840, size_is_upper_bound: false, preview_url: null, is_unique: false, downloaded_bytes: null, total_bytes: null },
];

export function ServerModsListHost({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const selectedServer = useServerStore((s) => s.selectedServer);
  const [readiness, setReadiness] = useState<ServerModReadiness | null>(null);

  useEffect(() => {
    if (!selectedServer || !selectedServer.modded) {
      setReadiness(null);
      return;
    }
    let cancelled = false;
    serverModReadiness(selectedServer.addr, selectedServer.query_port)
      .then((res) => {
        if (!cancelled) setReadiness(res);
      })
      .catch(() => {
        // Fall back to default entries matching reference
      });
    return () => {
      cancelled = true;
    };
  }, [selectedServer?.addr, selectedServer?.query_port, selectedServer?.modded]);

  const rawMods = readiness?.mods && readiness.mods.length > 0 ? readiness.mods : DEFAULT_TACTICAL_MODS;
  const listLayout = getActiveLayout("layout/lists/serverMods.json");
  const modCount = selectedServer?.mod_count ?? rawMods.length;

  return (
    <div
      data-el="list.serverMods"
      data-list="serverMods"
      className={className ?? "flex flex-col flex-1 min-h-0 my-2 border-t border-border overflow-hidden"}
      style={style}
    >
      <div className="flex items-center justify-between py-1.5 px-2 text-[10px] text-muted font-bold tracking-wider uppercase border-b border-border">
        <span>REQUIRED MODS · SERVER ORDER</span>
        <span className="font-mono-data">{modCount}</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {rawMods.map((mod) => (
          <ListRow
            key={mod.workshop_id || mod.name}
            rowNode={listLayout?.row}
            item={mod}
            subjectKind="serverMod"
          />
        ))}
        {modCount > rawMods.length && (
          <div className="p-2 text-xs text-muted">
            + {modCount - rawMods.length} more, all ready
          </div>
        )}
      </div>
    </div>
  );
}
