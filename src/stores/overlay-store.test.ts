import { beforeEach, describe, expect, it } from "vitest";
import type { Server } from "@/types/server";
import { useOverlayStore } from "./overlay-store";

const ids = () => useOverlayStore.getState().stack.map((o) => o.id);

beforeEach(() => {
  useOverlayStore.setState({ stack: [] });
});

describe("overlay stack", () => {
  it("keeps overlays in open order and closes the top one or a named one", () => {
    const info = { addr: "1.2.3.4:27016" } as Server;
    const { open, close, top } = useOverlayStore.getState();
    open("serverInfo", info);
    open("modFilter");
    expect(ids()).toEqual(["serverInfo", "modFilter"]);
    expect(top()?.id).toBe("modFilter");

    close();
    expect(ids()).toEqual(["serverInfo"]);
    expect(useOverlayStore.getState().top()?.payload).toBe(info);

    open("update");
    open("settings");
    close("update");
    expect(ids()).toEqual(["serverInfo", "settings"]);

    close();
    close();
    expect(ids()).toEqual([]);
  });
});
