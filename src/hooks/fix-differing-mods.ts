import { playerMessage } from "@/lib/player-message";
import { reinstallSubscribedMod, steamModStates } from "@/lib/tauri";
import { invalidateReadiness } from "@/stores/readiness-store";
import { useLaunchStore } from "@/stores/launch-store";
import type { Server } from "@/types/server";

const DOWNLOAD_FLIP_MS = 5_000;
const POLL_MS = 250;

const RETRY_MESSAGE = "Could not download the mod again. The launcher log has the details.";

export const SIGNATURE_ERROR = "You may be kicked on join with a signature error.";

/** The warning above Join, for however many copies differ. */
export function differingWording(count: number): string {
  return count === 1
    ? "1 mod differs from the server's copy. Fix and join downloads it again first."
    : `${count} mods differ from the server's copy. Fix and join downloads it again first.`;
}

/**
 * Re-downloads the mods whose local copy differs from the server's, then joins.
 * Steam's state lags the deleted folder, so it waits for a copy to show as
 * anything but ready before handing over to the normal verify-and-launch.
 */
export async function fixDifferingMods(
  server: Server,
  ids: string[],
  join: (s: Server) => Promise<void>,
  cancelled: () => boolean = () => false,
): Promise<void> {
  for (const id of ids) {
    if (cancelled()) return;
    try {
      await reinstallSubscribedMod(id);
    } catch (e) {
      useLaunchStore.getState().setNotice(server.addr, {
        kind: "plain",
        text: playerMessage(String(e), RETRY_MESSAGE),
      });
      return;
    }
  }

  invalidateReadiness();

  if (ids.length > 0) await waitForDownload(ids, DOWNLOAD_FLIP_MS);

  if (cancelled()) return;
  await join(server);
}

/** Resolves once any of `ids` is no longer ready, or `limitMs` runs out. */
async function waitForDownload(ids: string[], limitMs: number): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    try {
      const states = await steamModStates(ids);
      if (states.some((s) => s.state !== "ready")) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
