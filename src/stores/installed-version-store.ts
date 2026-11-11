import { create } from "zustand";
import { getInstalledDayzVersion } from "@/lib/tauri";

/** `""` stands for "no DayZ folder set", so the key is always a string. */
type PathKey = string;

interface VersionState {
  versions: Record<PathKey, string | null>;
}

const useVersionStore = create<VersionState>(() => ({ versions: {} }));

const pending = new Map<PathKey, Promise<string | null>>();

/**
 * The installed DayZ version for `dayzPath`, shared by every caller for that
 * folder: the filter menu, the chips and each row all read one result. A
 * failed read is not kept, and `fresh` reads again (DayZ may have updated
 * while the launcher stayed open).
 */
export function loadInstalledVersion(
  dayzPath: string | null,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<string | null> {
  const key = dayzPath ?? "";
  const started = pending.get(key);
  if (started && !fresh) return started;

  const request = getInstalledDayzVersion(dayzPath).then(
    (version) => {
      if (version === null) pending.delete(key);
      useVersionStore.setState((s) => ({ versions: { ...s.versions, [key]: version } }));
      return version;
    },
    () => {
      pending.delete(key);
      useVersionStore.setState((s) => ({ versions: { ...s.versions, [key]: null } }));
      return null;
    },
  );
  pending.set(key, request);
  return request;
}

/** The resolved version for `dayzPath`, or null until one lands. */
export function useLoadedVersion(dayzPath: string | null): string | null {
  return useVersionStore((s) => s.versions[dayzPath ?? ""] ?? null);
}
