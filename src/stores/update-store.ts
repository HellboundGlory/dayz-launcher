import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdate, isInstalledCopy, type UpdateInfo } from "@/lib/updater";

interface UpdateState {
  /** Null until `is_installed_copy` has resolved once. */
  installed: boolean | null;
  checking: boolean;
  /** True once a check has completed at least once, success or failure. */
  checked: boolean;
  available: UpdateInfo | null;
  /** The live `Update` handle backing `available` — needed to install it. */
  update: Update | null;
  error: string | null;
  installing: boolean;
  progress: { downloaded: number; total: number | null } | null;

  /** Resolves {@link installed}. Safe to call repeatedly — only runs once. */
  resolveInstalled: () => Promise<void>;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  installed: null,
  checking: false,
  checked: false,
  available: null,
  update: null,
  error: null,
  installing: false,
  progress: null,

  resolveInstalled: async () => {
    if (get().installed !== null) return;
    try {
      set({ installed: await isInstalledCopy() });
    } catch {
      // Unknown defaults to "not installed" — the safer side, since it only
      // gates auto-install and falls back to a manual download link.
      set({ installed: false });
    }
  },

  checkNow: async () => {
    if (get().checking) return;
    set({ checking: true, error: null });
    try {
      const result = await checkForUpdate();
      set({ available: result?.info ?? null, update: result?.update ?? null, checked: true });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ checking: false });
    }
  },

  /** Only meaningful when `installed` is true — see `installUpdate`'s doc. */
  install: async () => {
    const { update } = get();
    if (!update) return;
    set({ installing: true, error: null, progress: null });
    try {
      await installUpdate(update, (downloaded, total) => {
        set({ progress: { downloaded, total } });
      });
      // Relaunches on success; nothing left to update here.
    } catch (e) {
      set({ installing: false, error: String(e) });
    }
  },
}));
