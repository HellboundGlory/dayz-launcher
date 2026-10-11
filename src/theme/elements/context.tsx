import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import type { Server } from "@/types/server";
import type { ListSource } from "@/lib/tauri";
import { getPersistedCollapsed, setPersistedCollapsed } from "../interaction/store";

export type ViewId = "servers" | "fav" | "recent" | "mods";
export type ContextSubjectKind = "server" | "mod" | "serverMod" | "modServer" | "workshopMod";
export type ContextName = "row" | "selection" | "modal" | "modSelection" | "modFilterPreview" | "popup" | "listHeader";

export interface SubjectContext {
  kind: ContextSubjectKind;
  data: unknown;
}

export interface ElementContextValue {
  themeId: string;
  subjectContext: SubjectContext | null;
  contextName?: ContextName;
  collapsedRegions: Record<string, boolean>;
  collapseRules: CollapseRules;
  registerCollapseRules: (rules: CollapseRules) => () => void;
  toggleCollapsed: (regionId: string) => void;
  isCollapsed: (regionId: string, defaultCollapsed?: boolean) => boolean;
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  error: string | null;
  dismissError: () => void;
  storageDegraded: boolean;
  serverCounts: { total: number; populated: number };
  refreshedAt: string | null;
  steamConnected: boolean;
  listSource: ListSource | null;
  updateAvailable: { version: string } | null;
  updateBannerDismissed: boolean;
  dismissUpdateBanner: () => void;
  openUpdateModal: () => void;
  selectedServer: Server | null;
  selectedMod: unknown | null;
  previewMod: unknown | null;
  onRefresh: () => void;
  refreshing: boolean;
  discovering: boolean;
  devMode: boolean;
  onDevModeChange: (on: boolean) => void;
  openServerInfo: (server: Server) => void;
  openModFilter: () => void;
  modFilterOpen: boolean;
  closeModal: () => void;
}

const ElementContext = createContext<ElementContextValue>({
  themeId: "",
  subjectContext: null,
  collapsedRegions: {},
  collapseRules: {},
  registerCollapseRules: () => () => {},
  toggleCollapsed: () => {},
  isCollapsed: () => false,
  activeView: "servers",
  onViewChange: () => {},
  settingsOpen: false,
  onOpenSettings: () => {},
  onCloseSettings: () => {},
  error: null,
  dismissError: () => {},
  storageDegraded: false,
  serverCounts: { total: 0, populated: 0 },
  refreshedAt: null,
  steamConnected: false,
  listSource: null,
  updateAvailable: null,
  updateBannerDismissed: false,
  dismissUpdateBanner: () => {},
  openUpdateModal: () => {},
  selectedServer: null,
  selectedMod: null,
  previewMod: null,
  onRefresh: () => {},
  refreshing: false,
  discovering: false,
  devMode: false,
  onDevModeChange: () => {},
  openServerInfo: () => {},
  openModFilter: () => {},
  modFilterOpen: false,
  closeModal: () => {},
});

export const useElementContext = () => useContext(ElementContext);

const NO_COLLAPSED: Record<string, boolean> = {};

export interface CollapseRule {
  defaultCollapsed: boolean;
  collapseBelow?: number;
}

export type CollapseRules = Record<string, CollapseRule>;

/** A toggle made while narrow wins; a narrow window collapses; otherwise the saved choice. */
export function drawnCollapsed(override: boolean | undefined, narrow: boolean, saved: boolean): boolean {
  return override ?? (narrow || saved);
}

const narrowQuery = (collapseBelow: number) => `(width < ${collapseBelow}px)`;

function isNarrow(rule: CollapseRule | undefined): boolean {
  if (rule?.collapseBelow === undefined || typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(narrowQuery(rule.collapseBelow)).matches;
}

interface CollapseState {
  themeId: string;
  overrides: Record<string, boolean>;
}

/** Registers a layout's collapsible regions while it is mounted. */
export function useCollapseRules(rules: CollapseRules) {
  const { registerCollapseRules } = useElementContext();
  useLayoutEffect(() => registerCollapseRules(rules), [registerCollapseRules, rules]);
}

export function ElementContextProvider({
  children,
  value,
}: {
  children?: ReactNode;
  value?: Partial<ElementContextValue>;
}) {
  const themeId = value?.themeId ?? "";
  const [registrations, setRegistrations] = useState<{ rules: CollapseRules }[]>(() =>
    value?.collapseRules ? [{ rules: value.collapseRules }] : [],
  );
  const collapseRules = useMemo(() => {
    const all: CollapseRules = {};
    for (const { rules } of registrations) Object.assign(all, rules);
    return all;
  }, [registrations]);
  const registerCollapseRules = useCallback((rules: CollapseRules) => {
    const entry = { rules };
    setRegistrations((prev) => [...prev, entry]);
    return () => setRegistrations((prev) => prev.filter((other) => other !== entry));
  }, []);

  const [state, setState] = useState<CollapseState>(() => ({
    themeId,
    overrides: value?.collapsedRegions ?? NO_COLLAPSED,
  }));
  const overrides = state.themeId === themeId ? state.overrides : NO_COLLAPSED;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const cleanups = Object.entries(collapseRules).flatMap(([regionId, rule]) => {
      if (rule.collapseBelow === undefined) return [];
      const media = window.matchMedia(narrowQuery(rule.collapseBelow));
      const onChange = () =>
        setState((prev) => ({
          themeId: prev.themeId,
          overrides: Object.fromEntries(Object.entries(prev.overrides).filter(([id]) => id !== regionId)),
        }));
      media.addEventListener("change", onChange);
      return [() => media.removeEventListener("change", onChange)];
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [collapseRules]);

  const collapse = useMemo(() => {
    const isCollapsed = (regionId: string, defaultCollapsed = false) =>
      drawnCollapsed(
        overrides[regionId],
        isNarrow(collapseRules[regionId]),
        getPersistedCollapsed(themeId, regionId, collapseRules[regionId]?.defaultCollapsed ?? defaultCollapsed),
      );

    const toggleCollapsed = (regionId: string) => {
      const next = !isCollapsed(regionId);
      if (!isNarrow(collapseRules[regionId])) setPersistedCollapsed(themeId, regionId, next);
      setState((prev) => ({
        themeId,
        overrides: { ...(prev.themeId === themeId ? prev.overrides : NO_COLLAPSED), [regionId]: next },
      }));
    };

    return { collapsedRegions: overrides, isCollapsed, toggleCollapsed };
  }, [collapseRules, overrides, themeId]);

  const merged = useMemo<ElementContextValue>(() => ({
    themeId: "",
    subjectContext: null,
    activeView: "servers",
    onViewChange: () => {},
    settingsOpen: false,
    onOpenSettings: () => {},
    onCloseSettings: () => {},
    error: null,
    dismissError: () => {},
    storageDegraded: false,
    serverCounts: { total: 0, populated: 0 },
    refreshedAt: null,
    steamConnected: false,
    listSource: null,
    updateAvailable: null,
    updateBannerDismissed: false,
    dismissUpdateBanner: () => {},
    openUpdateModal: () => {},
    selectedServer: null,
    selectedMod: null,
    previewMod: null,
    onRefresh: () => {},
    refreshing: false,
    discovering: false,
    devMode: false,
    onDevModeChange: () => {},
    openServerInfo: () => {},
    openModFilter: () => {},
    modFilterOpen: false,
    closeModal: () => {},
    ...value,
    collapsedRegions: value?.collapsedRegions ?? collapse.collapsedRegions,
    collapseRules: value?.collapseRules ?? collapseRules,
    registerCollapseRules: value?.registerCollapseRules ?? registerCollapseRules,
    toggleCollapsed: value?.toggleCollapsed ?? collapse.toggleCollapsed,
    isCollapsed: value?.isCollapsed ?? collapse.isCollapsed,
  }), [value, collapse, collapseRules, registerCollapseRules]);

  return <ElementContext.Provider value={merged}>{children}</ElementContext.Provider>;
}

export function SubjectContextProvider({
  children,
  subject,
  contextName,
}: {
  children: ReactNode;
  subject: SubjectContext | null;
  contextName?: ContextName;
}) {
  const parent = useElementContext();
  const next = useMemo<ElementContextValue>(() => ({
    ...parent,
    subjectContext: subject,
    contextName: contextName ?? parent.contextName,
  }), [parent, subject, contextName]);

  return <ElementContext.Provider value={next}>{children}</ElementContext.Provider>;
}
