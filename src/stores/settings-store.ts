import { create } from "zustand";
import { getSettings, saveSettings } from "@/lib/tauri";

/**
 * Field names match the Rust `AppSettings` exactly — it serialises in camelCase
 * for this reason — so the store can be handed to `saveSettings` unaltered.
 */
export interface AppSettings {
  profileName: string;
  steamPath: string | null;
  dayzPath: string | null;
  workshopPath: string | null;
  maxConcurrentQueries: number;
  queryTimeoutMs: number;
  launchParams: string[];
  closeToTray: boolean;
  autoRefreshIntervalSecs: number;
  /** Launch automatically once every required mod has downloaded. */
  autoJoinAfterDownload: boolean;
}

interface SettingsState extends AppSettings {
  /** False until the on-disk settings have been read, so a save can't race the load. */
  loaded: boolean;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  load: () => Promise<void>;
  flush: () => Promise<void>;
}

const defaults: AppSettings = {
  profileName: "",
  steamPath: null,
  dayzPath: null,
  workshopPath: null,
  maxConcurrentQueries: 1024,
  queryTimeoutMs: 1000,
  launchParams: [],
  closeToTray: true,
  autoRefreshIntervalSecs: 60,
  autoJoinAfterDownload: true,
};

const KEYS = Object.keys(defaults) as (keyof AppSettings)[];

function pickSettings(state: SettingsState): AppSettings {
  // Send only the persisted fields — `loaded` and the actions are store
  // machinery and would fail to deserialise into the Rust struct.
  return Object.fromEntries(KEYS.map((k) => [k, state[k]])) as unknown as AppSettings;
}

/**
 * Writes are debounced: typing in the profile-name box fires a change per
 * keystroke, and each one would otherwise be a Tauri round trip plus a file
 * rewrite.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults,
  loaded: false,

  setSetting: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);

    // Don't write back before the initial read has landed, or the defaults
    // sitting in the store would overwrite the user's saved file.
    if (!get().loaded) return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveSettings(pickSettings(get())).catch((e) =>
        console.error("Failed to save settings:", e),
      );
    }, 400);
  },

  load: async () => {
    try {
      const saved = await getSettings();
      set({ ...saved, loaded: true });
    } catch (e) {
      console.error("Failed to load settings, using defaults:", e);
      set({ loaded: true });
    }
  },

  /** Force an immediate write, skipping the debounce. */
  flush: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!get().loaded) return;
    try {
      await saveSettings(pickSettings(get()));
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  },
}));
