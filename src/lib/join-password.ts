import { passwordStatus } from "@/lib/tauri";
import { usePasswordStore } from "@/stores/password-store";
import type { Server } from "@/types/server";

/** What the join passes on to the launch. `null` means the user backed out of joining. */
export interface JoinPassword {
  password?: string;
  remember: boolean;
  /** A password is saved for this server; Rust reads it at launch. */
  useSaved?: boolean;
}

/**
 * Decide what a join does about the server's password: nothing for an unlocked
 * server or a main-menu launch, nothing when one is saved (Rust reads it
 * itself), else ask for one.
 */
export async function passwordGate(
  server: Server,
  toMenu: boolean,
): Promise<JoinPassword | null> {
  if (toMenu || !server.locked) return { remember: false };

  const status = await passwordStatus(server.addr).catch(() => ({
    saved: false,
    keyring: false,
  }));
  if (status.saved) return { remember: false, useSaved: true };

  const entry = await usePasswordStore.getState().ask({
    addr: server.addr,
    serverName: server.name || server.addr,
    keyring: status.keyring,
  });
  return entry ? { password: entry.password, remember: entry.remember } : null;
}
