import { create } from "zustand";
import { getSettings, patchSettings, type AppSettingsDto } from "@/lib/tauri";

/**
 * The settings the launcher can write. `activeThemeId` is left out on purpose:
 * a theme activation is confirmed elsewhere, and a settings save must not
 * overwrite it.
 */
export type AppSettings = Omit<AppSettingsDto, "activeThemeId">;

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
  discordShowServer: true,
  memoryMapWarning: true,
  startWindow: true,
  appMenuOffered: false,
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
