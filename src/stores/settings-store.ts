import { create } from "zustand";
import { getSettings, saveSettings, type OnJoin } from "@/lib/tauri";

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
  /** The close button hides the launcher to the tray instead of quitting. */
  closeToTray: boolean;
  /** Independent of `closeToTray` — two buttons, two questions. */
  minimiseToTray: boolean;
  /** Interface scale, applied as a webview zoom factor (keeps layout/scroll coordinates in one space). */
  uiScale: number;
  /** Seconds between automatic refreshes of the visible rows. `0` is off. */
  autoRefreshIntervalSecs: number;
  /** Register the launcher to start with Windows. No-op in debug builds — test against a release build. */
  startWithWindows: boolean;
  /** Start hidden in the tray. Only applies when Windows did the starting. */
  startMinimised: boolean;
  /** What the launcher does with itself once DayZ is starting. */
  onJoin: OnJoin;
  /** Launch automatically once every required mod has downloaded. */
  autoJoinAfterDownload: boolean;
  /** Hide hosting-company defaults like "nitrado.net gameserver". */
  hidePlaceholderServers: boolean;
  /** ENGLISH ONLY tag. `true` keeps English names, `false` non-English, `null` unfiltered. Lives here, not the filter store, since it defaults on. */
  englishNamesFilter: boolean | null;
  /** Show "Playing on {server}" / "Browsing servers" in Discord. */
  discordRichPresence: boolean;
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
  minimiseToTray: false,
  // Matches the Rust `DEFAULT_UI_SCALE`. Only ever seen for the instant before
  // `load()` returns — the file is the authority.
  uiScale: 1.25,
  // Off by default — see the Rust `AppSettings::default` for why this is 0 and
  // not the 60 it carried while nothing read it.
  autoRefreshIntervalSecs: 0,
  startWithWindows: false,
  startMinimised: false,
  onJoin: "stay",
  autoJoinAfterDownload: true,
  hidePlaceholderServers: true,
  englishNamesFilter: true,
  discordRichPresence: true,
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
      // Leave `loaded` false so nothing writes hardcoded defaults back over
      // the user's real settings.json on a transient read failure.
      console.error("Failed to load settings, not saving until a load succeeds:", e);
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
