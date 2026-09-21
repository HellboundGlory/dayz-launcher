import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Server } from "@/types/server";
import type { ListSource } from "@/lib/tauri";
import { getPersistedCollapsed, setPersistedCollapsed } from "../interaction/store";

export type ViewId = "servers" | "fav" | "recent" | "mods";
export type ContextSubjectKind = "server" | "mod" | "serverMod" | "modServer" | "workshopMod";
export type ContextName = "row" | "selection" | "modal" | "modSelection" | "modFilterPreview" | "popup";

export interface SubjectContext {
  kind: ContextSubjectKind;
  data: unknown;
}

export interface ElementContextValue {
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
}

const ElementContext = createContext<ElementContextValue>({
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
});

export const useElementContext = () => useContext(ElementContext);

export function ElementContextProvider({
  children,
  value,
}: {
  children?: ReactNode;
  value?: Partial<ElementContextValue>;
}) {
  const [collapsedRegions, setCollapsedRegions] = useState<Record<string, boolean>>(
    value?.collapsedRegions ?? {},
  );

  const toggleCollapsed = (regionId: string) => {
    setCollapsedRegions((prev) => {
      const current = prev[regionId] ?? getPersistedCollapsed("", regionId, false);
      const next = !current;
      setPersistedCollapsed("", regionId, next);
      return { ...prev, [regionId]: next };
    });
  };

  const isCollapsed = (regionId: string) => {
    if (collapsedRegions[regionId] !== undefined) {
      return !!collapsedRegions[regionId];
    }
    return getPersistedCollapsed("", regionId, false);
  };


  const merged = useMemo<ElementContextValue>(() => ({
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
    ...value,
    collapsedRegions: value?.collapsedRegions ?? collapsedRegions,
    toggleCollapsed: value?.toggleCollapsed ?? toggleCollapsed,
    isCollapsed: value?.isCollapsed ?? isCollapsed,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [value, collapsedRegions]);

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
