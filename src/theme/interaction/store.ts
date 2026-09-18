const memoryStore = new Map<string, string>();

function normalizeTheme(themeId: string): string {
  return themeId.trim() ? themeId : "default";
}

export const tabsKey = (themeId: string, containerId: string): string =>
  `theme:${normalizeTheme(themeId)}:tabs:${containerId}`;

export const accordionKey = (themeId: string, containerId: string): string =>
  `theme:${normalizeTheme(themeId)}:accordion:${containerId}`;

export const collapsibleKey = (themeId: string, regionId: string): string =>
  `theme:${normalizeTheme(themeId)}:collapsible:${regionId}`;

export const resizableKey = (themeId: string, regionId: string): string =>
  `theme:${normalizeTheme(themeId)}:resizable:${regionId}`;

function getStorageItem(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // fallback to in-memory store
  }
  return memoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }
  } catch {
    // fallback to in-memory store
  }
  memoryStore.set(key, value);
}

export function getPersistedTab(
  themeId: string,
  containerId: string,
  defaultTab?: string,
): string | undefined {
  const val = getStorageItem(tabsKey(themeId, containerId));
  return val ?? defaultTab;
}

export function setPersistedTab(
  themeId: string,
  containerId: string,
  tabId: string,
): void {
  setStorageItem(tabsKey(themeId, containerId), tabId);
}

export function getPersistedAccordion(
  themeId: string,
  containerId: string,
  initialMode: "none" | "first",
  firstId?: string,
): string[] {
  const raw = getStorageItem(accordionKey(themeId, containerId));
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // invalid payload: fallback to initial mode
    }
  }
  return initialMode === "first" && firstId ? [firstId] : [];
}

export function setPersistedAccordion(
  themeId: string,
  containerId: string,
  openIds: string[],
): void {
  setStorageItem(accordionKey(themeId, containerId), JSON.stringify(openIds));
}

export function getPersistedCollapsed(
  themeId: string,
  regionId: string,
  defaultCollapsed = false,
): boolean {
  const raw = getStorageItem(collapsibleKey(themeId, regionId));
  if (raw === "true") return true;
  if (raw === "false") return false;
  return defaultCollapsed;
}

export function setPersistedCollapsed(
  themeId: string,
  regionId: string,
  collapsed: boolean,
): void {
  setStorageItem(collapsibleKey(themeId, regionId), String(collapsed));
}

export function getPersistedSize(
  themeId: string,
  regionId: string,
): string | undefined {
  const val = getStorageItem(resizableKey(themeId, regionId));
  return val ?? undefined;
}

export function setPersistedSize(
  themeId: string,
  regionId: string,
  size: string,
): void {
  setStorageItem(resizableKey(themeId, regionId), size);
}

export function clearInteractionMemory(): void {
  memoryStore.clear();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith("theme:")) toRemove.push(k);
      }
      toRemove.forEach((k) => window.localStorage.removeItem(k));
    }
  } catch {
    // ignore in environments without localStorage
  }
}

export function clearThemeInteraction(themeId: string): void {
  const prefix = `theme:${normalizeTheme(themeId)}:`;
  for (const k of Array.from(memoryStore.keys())) {
    if (k.startsWith(prefix)) memoryStore.delete(k);
  }
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(prefix)) toRemove.push(k);
      }
      toRemove.forEach((k) => window.localStorage.removeItem(k));
    }
  } catch {
    // ignore
  }
}
