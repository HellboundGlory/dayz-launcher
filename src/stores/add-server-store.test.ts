import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@/types/server";
import { lookupReady, useAddServerStore } from "./add-server-store";
import { useServerStore } from "./server-store";

const { findServer, toggleFavourite } = vi.hoisted(() => ({
  findServer: vi.fn<(input: string) => Promise<Server | null>>(),
  toggleFavourite: vi.fn<(addr: string, port: number, favourite: boolean) => Promise<void>>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, findServer, toggleFavourite };
});

const server = {
  addr: "46.7.13.31:2303",
  query_port: 2303,
  game_port: 2302,
  name: "RED HORIZON",
  favourite: false,
} as Server;

beforeEach(() => {
  vi.useFakeTimers();
  findServer.mockReset();
  toggleFavourite.mockReset();
  useServerStore.setState({ servers: [], selectedServer: null });
  useAddServerStore.setState({ open: false, input: "", state: "idle", server: null, message: null, busy: false });
});

afterEach(() => {
  useAddServerStore.getState().close();
  vi.useRealTimers();
});

describe("lookupReady", () => {
  it.each([
    { text: "1.2.3.4", ready: true },
    { text: "play.example.com:2302", ready: true },
    { text: "  play.example.com  ", ready: true },
    { text: "", ready: false },
    { text: "   ", ready: false },
    { text: "play example.com", ready: false },
  ])("$text -> $ready", ({ text, ready }) => {
    expect(lookupReady(text)).toBe(ready);
  });
});

describe("add server store", () => {
  it("opens with a clean slate and closes back to it", () => {
    useAddServerStore.getState().show();
    expect(useAddServerStore.getState()).toMatchObject({ open: true, input: "", state: "idle" });

    useAddServerStore.getState().close();
    expect(useAddServerStore.getState().open).toBe(false);
  });

  it("waits 700 ms after the last keystroke, then looks once", async () => {
    findServer.mockResolvedValue(server);

    useAddServerStore.getState().type("play.example.com");
    await vi.advanceTimersByTimeAsync(600);
    expect(findServer).not.toHaveBeenCalled();
    expect(useAddServerStore.getState().state).toBe("idle");

    await vi.advanceTimersByTimeAsync(100);
    expect(findServer).toHaveBeenCalledTimes(1);
    expect(findServer).toHaveBeenCalledWith("play.example.com");
    expect(useAddServerStore.getState()).toMatchObject({ state: "found", server });
  });

  it("looks at once on submit", () => {
    findServer.mockResolvedValue(server);

    useAddServerStore.getState().type("1.2.3.4");
    useAddServerStore.getState().submit();

    expect(findServer).toHaveBeenCalledTimes(1);
    expect(findServer).toHaveBeenCalledWith("1.2.3.4");
  });

  it("restarts the wait when typing continues inside 700 ms", async () => {
    findServer.mockResolvedValue(server);

    useAddServerStore.getState().type("play");
    await vi.advanceTimersByTimeAsync(500);
    useAddServerStore.getState().type("play.example.com");
    await vi.advanceTimersByTimeAsync(600);

    expect(findServer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(findServer).toHaveBeenCalledTimes(1);
    expect(findServer).toHaveBeenCalledWith("play.example.com");
  });

  it("drops a slow reply for older input", async () => {
    let resolveOld: (value: Server | null) => void = () => {};
    findServer.mockReturnValueOnce(new Promise<Server | null>((resolve) => (resolveOld = resolve)));
    useAddServerStore.getState().type("old.example.com");
    await vi.advanceTimersByTimeAsync(700);

    findServer.mockResolvedValueOnce(server);
    useAddServerStore.getState().type("new.example.com");
    await vi.advanceTimersByTimeAsync(700);
    expect(useAddServerStore.getState().state).toBe("found");

    resolveOld({ ...server, name: "OLD" });
    await vi.advanceTimersByTimeAsync(0);

    expect(useAddServerStore.getState().server?.name).toBe("RED HORIZON");
  });

  it("asks nothing for empty text or text with a space", async () => {
    useAddServerStore.getState().type("");
    await vi.advanceTimersByTimeAsync(1000);
    useAddServerStore.getState().type("play example.com");
    await vi.advanceTimersByTimeAsync(1000);

    expect(findServer).not.toHaveBeenCalled();
  });

  it("reports a silent host as notFound", async () => {
    findServer.mockResolvedValue(null);

    useAddServerStore.getState().type("nothing.example.com");
    await vi.advanceTimersByTimeAsync(700);

    expect(useAddServerStore.getState().state).toBe("notFound");
  });

  it("keeps the command's own message when the lookup rejects", async () => {
    findServer.mockRejectedValue("Could not find that host name");

    useAddServerStore.getState().type("missing.example.com");
    useAddServerStore.getState().submit();
    await vi.advanceTimersByTimeAsync(0);

    expect(useAddServerStore.getState()).toMatchObject({
      state: "error",
      message: "Could not find that host name",
    });
  });

  it("saves the found server as a favourite and closes", async () => {
    findServer.mockResolvedValue(server);
    toggleFavourite.mockResolvedValue(undefined);
    useAddServerStore.getState().show();
    useAddServerStore.getState().type("play.example.com");
    await vi.advanceTimersByTimeAsync(700);

    await useAddServerStore.getState().favourite();

    expect(toggleFavourite).toHaveBeenCalledWith(server.addr, server.query_port, true);
    expect(useAddServerStore.getState().open).toBe(false);
  });

  it("undoes the optimistic favourite, stays open and says why when the write fails", async () => {
    findServer.mockResolvedValue(server);
    let refuse: (e: Error) => void = () => {};
    toggleFavourite.mockReturnValue(new Promise((_, reject) => (refuse = reject)));
    useAddServerStore.getState().show();
    useAddServerStore.getState().type("play.example.com");
    await vi.advanceTimersByTimeAsync(700);
    useServerStore.setState({ servers: [{ ...server, favourite: false }] });

    const pending = useAddServerStore.getState().favourite();
    expect(useServerStore.getState().servers[0]?.favourite).toBe(true);
    refuse(new Error("refused"));
    await pending;

    expect(useAddServerStore.getState().open).toBe(true);
    expect(useServerStore.getState().servers[0]?.favourite).toBe(false);
    expect(useAddServerStore.getState().state).toBe("found");
    expect(useAddServerStore.getState().message).toContain("refused");
  });

  it("does not ask again while a lookup for the same text is running", () => {
    findServer.mockReturnValue(new Promise(() => {}));
    useAddServerStore.getState().show();
    useAddServerStore.setState({ input: "play.example.com" });
    useAddServerStore.getState().submit();
    useAddServerStore.getState().submit();

    expect(findServer).toHaveBeenCalledTimes(1);
  });
});
