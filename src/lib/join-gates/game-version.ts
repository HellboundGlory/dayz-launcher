import { useConfirmStore } from "@/stores/confirm-store";
import { loadInstalledVersion } from "@/stores/installed-version-store";
import { useSettingsStore } from "@/stores/settings-store";
import { versionMismatch } from "@/lib/game-version";
import type { Server } from "@/types/server";

export const VERSION_MISMATCH_MESSAGE =
  "This server runs a different DayZ version than yours. DayZ usually refuses to join " +
  "until they match: update DayZ in Steam, or wait for the server to update.";

/**
 * Asks before joining a server on another DayZ build. Lets the join through when
 * the versions match or the installed one can't be read; loading to the menu
 * never asks.
 */
export async function confirmGameVersion(server: Server, toMenu: boolean): Promise<boolean> {
  if (toMenu) return true;

  const dayzPath = useSettingsStore.getState().dayzPath;
  const installed = await loadInstalledVersion(dayzPath, { fresh: true });
  const mismatch = versionMismatch(server.version, installed);
  if (!mismatch) return true;

  return new Promise<boolean>((resolve) => {
    useConfirmStore.getState().ask(
      "Different game version",
      VERSION_MISMATCH_MESSAGE,
      () => resolve(true),
      "Join anyway",
      {
        rows: [
          ["Server", mismatch.server],
          ["Yours", mismatch.yours],
        ],
        onCancel: () => resolve(false),
        destructive: false,
        warning: true,
      },
    );
  });
}
