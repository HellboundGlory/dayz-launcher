import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@/types/server";

const { passwordStatus } = vi.hoisted(() => ({
  passwordStatus: vi.fn<(addr: string) => Promise<{ saved: boolean; keyring: boolean }>>(),
}));

vi.mock("@/lib/tauri", () => ({ passwordStatus }));

import { passwordGate } from "./join-password";
import { usePasswordStore } from "@/stores/password-store";

const server: Server = {
  addr: "1.2.3.4:27016",
  game_port: 2302,
  query_port: 27016,
  name: "Test Server",
  map_display: "Chernarus",
  players: 10,
  max_players: 60,
  ping: 30,
  locked: true,
  vac: true,
  version: "1.25",
  in_game_time: "12:00",
  queue: null,
  day_multiplier: null,
  night_multiplier: null,
  mod_count: 0,
  country_code: null,
  last_played: null,
  favourite: false,
  official: false,
  modded: false,
  first_person: false,
  battleye: true,
  online: true,
};

afterEach(() => {
  usePasswordStore.getState().cancel();
  passwordStatus.mockReset();
});

describe("passwordGate", () => {
  it("asks nothing for an unlocked server", async () => {
    await expect(passwordGate({ ...server, locked: false }, false)).resolves.toEqual({
      remember: false,
    });
    expect(passwordStatus).not.toHaveBeenCalled();
  });

  it("asks nothing when launching to the main menu", async () => {
    await expect(passwordGate(server, true)).resolves.toEqual({ remember: false });
    expect(passwordStatus).not.toHaveBeenCalled();
  });

  it("opens the dialog when nothing is saved", async () => {
    passwordStatus.mockResolvedValue({ saved: false, keyring: true });
    let settled = false;
    const gate = passwordGate(server, false).then((r) => {
      settled = true;
      return r;
    });
    await vi.waitFor(() => expect(usePasswordStore.getState().request).not.toBeNull());
    expect(usePasswordStore.getState().request?.serverName).toBe("Test Server");

    usePasswordStore.getState().setDraft("pw");
    usePasswordStore.getState().submit();
    await expect(gate).resolves.toEqual({ password: "pw", remember: true });
    expect(settled).toBe(true);
  });

  it("cancels the join when the dialog is cancelled", async () => {
    passwordStatus.mockResolvedValue({ saved: false, keyring: true });
    const gate = passwordGate(server, false);
    await vi.waitFor(() => expect(usePasswordStore.getState().request).not.toBeNull());
    usePasswordStore.getState().cancel();
    await expect(gate).resolves.toBeNull();
  });

  it("joins without a prompt when the password is saved", async () => {
    passwordStatus.mockResolvedValue({ saved: true, keyring: true });
    await expect(passwordGate(server, false)).resolves.toEqual({
      remember: false,
      useSaved: true,
    });
    expect(usePasswordStore.getState().request).toBeNull();
  });

  it("asks without remembering when the keyring cannot be read", async () => {
    passwordStatus.mockRejectedValue(new Error("no store"));
    const gate = passwordGate(server, false);
    await vi.waitFor(() => expect(usePasswordStore.getState().request).not.toBeNull());
    expect(usePasswordStore.getState().request?.keyring).toBe(false);
    usePasswordStore.getState().cancel();
    await expect(gate).resolves.toBeNull();
  });
});
