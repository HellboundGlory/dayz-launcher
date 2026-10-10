import { create } from "zustand";

export interface FallbackStore {
  fallbackFiles: Record<string, boolean>;
  fallbackReasons: Record<string, string[]>;
  fallbackNoticeDismissed: Record<string, boolean>;
  /** Files the screen check marked at runtime, as opposed to validation fall-backs. */
  runtimeFiles: Record<string, boolean>;
  markFileFallback: (themeId: string, file: string, reason: string | string[]) => void;
  markRuntimeFallback: (file: string, reason: string | string[]) => void;
  isFileFallenBack: (file: string) => boolean;
  clearFallbacks: () => void;
  clearRuntimeFallbacks: () => void;
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

function withFallback(
  state: Pick<FallbackStore, "fallbackFiles" | "fallbackReasons">,
  file: string,
  reason: string | string[],
) {
  const reasonsToAdd = Array.isArray(reason) ? reason : [reason];
  const prev = state.fallbackReasons[file] ?? [];
  return {
    fallbackFiles: { ...state.fallbackFiles, [file]: true },
    fallbackReasons: { ...state.fallbackReasons, [file]: [...prev, ...reasonsToAdd] },
  };
}

export const useFallbackStore = create<FallbackStore>((set, get) => ({
  fallbackFiles: {},
  fallbackReasons: {},
  fallbackNoticeDismissed: {},
  runtimeFiles: {},

  markFileFallback: (_themeId, file, reason) => {
    set((state) => withFallback(state, file, reason));
  },

  markRuntimeFallback: (file, reason) => {
    set((state) => ({
      ...withFallback(state, file, reason),
      runtimeFiles: { ...state.runtimeFiles, [file]: true },
    }));
  },

  isFileFallenBack: (file) => {
    return Boolean(get().fallbackFiles[file]);
  },

  clearFallbacks: () => {
    set({ fallbackFiles: {}, fallbackReasons: {}, runtimeFiles: {} });
  },

  clearRuntimeFallbacks: () => {
    set((state) => {
      const files = Object.keys(state.runtimeFiles);
      if (files.length === 0) return state;
      const fallbackFiles = { ...state.fallbackFiles };
      const fallbackReasons = { ...state.fallbackReasons };
      for (const file of files) {
        delete fallbackFiles[file];
        delete fallbackReasons[file];
      }
      return { fallbackFiles, fallbackReasons, runtimeFiles: {} };
    });
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

export function markRuntimeFallback(file: string, reason: string | string[]): void {
  useFallbackStore.getState().markRuntimeFallback(file, reason);
}

export function clearFallbacks(): void {
  useFallbackStore.getState().clearFallbacks();
}

export function clearRuntimeFallbacks(): void {
  useFallbackStore.getState().clearRuntimeFallbacks();
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
    runtimeFiles: {},
  });
}
