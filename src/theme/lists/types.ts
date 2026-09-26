import type { ColumnDef, LayoutNode } from "../renderer/types";

export type { ColumnDef };

export interface ListFile {
  schemaVersion: 2;
  columns?: ColumnDef[];
  header?: boolean;
  row?: LayoutNode;
  empty?: LayoutNode;
}

export interface SortState {
  key: string;
  direction: "ascending" | "descending";
}

export type ListId =
  | "list.servers"
  | "list.mods"
  | "list.modFilterResults"
  | "list.serverMods"
  | "list.modServers";
