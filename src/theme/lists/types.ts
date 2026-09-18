import type { LayoutNode } from "../renderer/types";

export interface ColumnDef {
  id: string;
  label?: string;
  width: string;
  minWidth?: string;
  maxWidth?: string;
  align?: "start" | "center" | "end";
  sort?: string;
}

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
