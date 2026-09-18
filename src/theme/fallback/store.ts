import { create } from "zustand";

export interface FallbackStore {
  fallbackFiles: Record<string, boolean>;
  fallbackReasons: Record<string, string[]>;
  fallbackNoticeDismissed: Record<string, boolean>;
  markFileFallback: (themeId: string, file: string, reason: string | string[]) => void;
  isFileFallenBack: (file: string) => boolean;
  clearFallbacks: () => void;
  isFallbackNoticeDismissed: (themeId: string, version: string) => boolean;
  dismissFallbackNotice: (themeId: string, version: string) => void;
}

const memoryDismissed = new Map<string, boolean>();

function getDismissedKey(themeId: string, version: string): string {
  return `tetra:fallbackDismissed:${themeId}:${version}`;
}

function readPersistedDismissed(themeId: string, version: string): boolean {
  const key = getDismissedKey(themeId, version);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null) return val === "true";
    }
  } catch {
    // fallback to in-memory store
  }
  return memoryDismissed.get(key) ?? false;
}

function writePersistedDismissed(themeId: string, version: string, dismissed: boolean): void {
  const key = getDismissedKey(themeId, version);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, String(dismissed));
      return;
    }
  } catch {
    // fallback to in-memory store
  }
  memoryDismissed.set(key, dismissed);
}

export const useFallbackStore = create<FallbackStore>((set, get) => ({
  fallbackFiles: {},
  fallbackReasons: {},
  fallbackNoticeDismissed: {},

  markFileFallback: (_themeId, file, reason) => {
    const reasonsToAdd = Array.isArray(reason) ? reason : [reason];
    set((state) => {
      const prev = state.fallbackReasons[file] ?? [];
      return {
        fallbackFiles: { ...state.fallbackFiles, [file]: true },
        fallbackReasons: { ...state.fallbackReasons, [file]: [...prev, ...reasonsToAdd] },
      };
    });
  },

  isFileFallenBack: (file) => {
    return Boolean(get().fallbackFiles[file]);
  },

  clearFallbacks: () => {
    set({ fallbackFiles: {}, fallbackReasons: {} });
  },

  isFallbackNoticeDismissed: (themeId, version) => {
    const key = `${themeId}:${version}`;
    const inStore = get().fallbackNoticeDismissed[key];
    if (inStore !== undefined) return inStore;
    const persisted = readPersistedDismissed(themeId, version);
    if (persisted) {
      set((s) => ({
        fallbackNoticeDismissed: { ...s.fallbackNoticeDismissed, [key]: true },
      }));
    }
    return persisted;
  },

  dismissFallbackNotice: (themeId, version) => {
    const key = `${themeId}:${version}`;
    writePersistedDismissed(themeId, version, true);
    set((s) => ({
      fallbackNoticeDismissed: { ...s.fallbackNoticeDismissed, [key]: true },
    }));
  },
}));

export function markFileFallback(themeId: string, file: string, reason: string | string[]): void {
  useFallbackStore.getState().markFileFallback(themeId, file, reason);
}

export function isFileFallenBack(file: string): boolean {
  return useFallbackStore.getState().isFileFallenBack(file);
}

export function clearFallbacks(): void {
  useFallbackStore.getState().clearFallbacks();
}

export function isFallbackNoticeDismissed(themeId: string, version: string): boolean {
  return useFallbackStore.getState().isFallbackNoticeDismissed(themeId, version);
}

export function dismissFallbackNotice(themeId: string, version: string): void {
  useFallbackStore.getState().dismissFallbackNotice(themeId, version);
}

export function clearFallbackMemory(): void {
  memoryDismissed.clear();
  useFallbackStore.setState({
    fallbackFiles: {},
    fallbackReasons: {},
    fallbackNoticeDismissed: {},
  });
}
