import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Whether this running copy lives where the NSIS installer puts it. */
export async function isInstalledCopy(): Promise<boolean> {
  return invoke<boolean>("is_installed_copy");
}

export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

/**
 * Checks the endpoint in `tauri.conf.json` (GitHub Releases' `latest.json`)
 * for a newer version. Resolves to `null` when already current — this only
 * throws for an actual failure to reach the endpoint, never for "no update".
 */
export async function checkForUpdate(): Promise<{ info: UpdateInfo; update: Update } | null> {
  const update = await check();
  if (!update?.available) return null;
  return {
    update,
    info: { version: update.version, date: update.date, body: update.body },
  };
}

/**
 * Downloads and installs the given update, then relaunches.
 *
 * Only meaningful for an installed copy: for a portable exe this would run
 * the NSIS installer in the background and silently convert the user to an
 * installed copy elsewhere on disk. Callers gate this behind
 * {@link isInstalledCopy} and offer a "view release" link instead.
 */
export async function installUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let total: number | null = null;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, total);
        break;
      case "Finished":
        break;
    }
  });
  await relaunch();
}
