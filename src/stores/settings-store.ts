import { create } from "zustand";
import { getSettings, patchSettings, type OnJoin } from "@/lib/tauri";

/**
 * Field names match the Rust `AppSettings` exactly — it serialises in camelCase
 * for this reason — so a patch can name a field by the key the store uses.
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
  /** Seconds between automatic refreshes of the first 5,000 servers in the list. `0` is off. */
  autoRefreshIntervalSecs: number;
  /** Register the launcher to start with Windows. No-op in debug builds — test against a release build. */
  startWithWindows: boolean;
  /** Start hidden in the tray. Only applies when Windows did the starting. */
  startMinimised: boolean;
  /** What the launcher does with itself once DayZ is starting. */
  onJoin: OnJoin;
  /** Set once the first-launch setup modal is completed or skipped. */
  onboardingDismissed: boolean;
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
  maxConcurrentQueries: 256,
  queryTimeoutMs: 1000,
  launchParams: [],
  closeToTray: true,
  minimiseToTray: false,
  // Matches the Rust `DEFAULT_UI_SCALE`. Only ever seen for the instant before
  // `load()` returns — the file is the authority.
  uiScale: 1.25,
  // 60 s — matches the Rust default. Pings are per-user (the index carries
  // none), so a minute after load the top rows have numbers.
  autoRefreshIntervalSecs: 60,
  startWithWindows: false,
  startMinimised: false,
  onJoin: "stay",
  onboardingDismissed: false,
  discordRichPresence: true,
};

/** Keys changed since the last patch. Only these are sent, so a save never rewrites a field this store did not touch. */
const dirty = new Set<keyof AppSettings>();

/** Patches go out one after another, so a later value can't land before an earlier one. */
let sending: Promise<void> = Promise.resolve();

/**
 * Writes are debounced: typing in the profile-name box fires a change per
 * keystroke, and each one would otherwise be a Tauri round trip plus a file
 * rewrite.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function sendDirty(): Promise<void> {
  const keys = [...dirty];
  dirty.clear();
  if (keys.length === 0) return sending;
  const state = useSettingsStore.getState();
  const patch = Object.fromEntries(keys.map((k) => [k, state[k]])) as Partial<AppSettings>;
  sending = sending.then(() => patchSettings(patch)).then(undefined, (e) => {
    // Keep the keys so the next save retries them.
    keys.forEach((k) => dirty.add(k));
    console.error("Failed to save settings:", e);
  });
  return sending;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults,
  loaded: false,

  setSetting: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);

    // Don't write back before the initial read has landed, or the defaults
    // sitting in the store would overwrite the user's saved file.
    if (!get().loaded) return;

    dirty.add(key);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void sendDirty();
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
    await sendDirty();
  },
}));
