import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
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
  toggleCollapsed: (regionId: string) => void;
  isCollapsed: (regionId: string) => boolean;
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

export function ElementContextProvider({
  children,
  value,
}: {
  children?: ReactNode;
  value?: Partial<ElementContextValue>;
}) {
  const themeId = value?.themeId ?? "";
  const [collapsed, setCollapsed] = useState<{ themeId: string; regions: Record<string, boolean> }>(() => ({
    themeId,
    regions: value?.collapsedRegions ?? {},
  }));
  const collapsedRegions = collapsed.themeId === themeId ? collapsed.regions : NO_COLLAPSED;

  const toggleCollapsed = (regionId: string) => {
    const current = collapsedRegions[regionId] ?? getPersistedCollapsed(themeId, regionId, false);
    const next = !current;
    setPersistedCollapsed(themeId, regionId, next);
    setCollapsed({ themeId, regions: { ...collapsedRegions, [regionId]: next } });
  };

  const isCollapsed = (regionId: string) => {
    if (collapsedRegions[regionId] !== undefined) {
      return !!collapsedRegions[regionId];
    }
    return getPersistedCollapsed(themeId, regionId, false);
  };


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
    collapsedRegions: value?.collapsedRegions ?? collapsedRegions,
    toggleCollapsed: value?.toggleCollapsed ?? toggleCollapsed,
    isCollapsed: value?.isCollapsed ?? isCollapsed,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [value, collapsedRegions, themeId]);

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
