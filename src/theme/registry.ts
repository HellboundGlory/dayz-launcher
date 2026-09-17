import registry from "./registry.json";

export type ElementKind = "display" | "input" | "action" | "nav" | "notice" | "list" | "block";
export type Subject = "server" | "mod" | "serverMod" | "modServer" | "workshopMod";
export type Multiplicity = "many" | "perComposition" | "perContext";
export type OptionDef =
  | { type: "enum"; values: (string | number)[]; default?: string | number }
  | { type: "boolean"; default?: boolean }
  | { type: "icon" | "text" | "length" | "token"; default?: string }
  | { type: "region" };
export type FallbackPlacement = "append" | `afterElement:${string}` | `anchor:${string}`;

export interface ElementDef {
  kind: ElementKind;
  subject?: Subject;
  where: string[];
  excludedWhere?: string[];
  required: string[];
  multiplicity: Multiplicity;
  multiplicityScope?: "region";
  options: Record<string, OptionDef>;
  freeLabel: boolean;
  parts: string[];
  states: string[];
  since: "2.0";
  aliases: string[];
  fallbackPlacement?: Record<string, FallbackPlacement>;
}

export interface SurfaceDef {
  where: string[];
  contains: string[];
}

export interface SortDef {
  key: string;
  direction: "ascending" | "descending";
}

export interface ListDef {
  subject: Subject;
  template: string;
  sortKeys: string[];
  defaultSort?: SortDef;
  states: string[];
}

export interface ModalDef {
  file: string;
  subject: Subject | null;
  required: string[];
}

export interface PopupDef {
  openedBy: string;
  requiredContents: string[];
}

export interface BlockDef {
  where: string[];
}

export interface Registry {
  registryVersion: "2.0";
  elements: Record<string, ElementDef>;
  surfaces: Record<string, SurfaceDef>;
  lists: Record<string, ListDef>;
  modals: Record<string, ModalDef>;
  popups: Record<string, PopupDef>;
  blocks: Record<string, BlockDef>;
  icons: string[];
}

// JSON imports widen string literals; registry.test.ts checks the shared data.
export const REGISTRY = registry as Registry;
