import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  copyAddress,
  copyServerAddress,
  checkServerMods,
  getUniqueModsSummary,
  unsubscribeUniqueMods,
} from "./tauri";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("copyAddress and copyServerAddress", () => {
  let writtenText = "";

  beforeEach(() => {
    writtenText = "";
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async (text: string) => {
          writtenText = text;
        }),
      },
    });
  });

  it("writes host and game port to clipboard", async () => {
    await copyAddress("192.168.1.50", 2302);
    expect(writtenText).toBe("192.168.1.50:2302");
  });

  it("strips embedded query port before appending game port", async () => {
    await copyAddress("192.168.1.50:27016", 2302);
    expect(writtenText).toBe("192.168.1.50:2302");
  });

  it("copyServerAddress calls copyAddress with server properties", async () => {
    await copyServerAddress({ addr: "10.0.0.1:27016", game_port: 2303 });
    expect(writtenText).toBe("10.0.0.1:2303");
  });
});

describe("server mods tauri command wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checkServerMods invokes check_server_mods with addr and queryPort", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ stale: false, mods: [] });
    const res = await checkServerMods("127.0.0.1", 27016);
    expect(invoke).toHaveBeenCalledWith("check_server_mods", {
      addr: "127.0.0.1",
      queryPort: 27016,
    });
    expect(res).toEqual({ stale: false, mods: [] });
  });

  it("getUniqueModsSummary invokes get_unique_mods_summary", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ count: 3, total_size_bytes: 12345 });
    const res = await getUniqueModsSummary("127.0.0.1", 27016);
    expect(invoke).toHaveBeenCalledWith("get_unique_mods_summary", {
      addr: "127.0.0.1",
      queryPort: 27016,
    });
    expect(res).toEqual({ count: 3, total_size_bytes: 12345 });
  });

  it("unsubscribeUniqueMods invokes unsubscribe_unique_mods", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ count: 2, total_size_bytes: 9999 });
    const res = await unsubscribeUniqueMods("127.0.0.1", 27016);
    expect(invoke).toHaveBeenCalledWith("unsubscribe_unique_mods", {
      addr: "127.0.0.1",
      queryPort: 27016,
    });
    expect(res).toEqual({ count: 2, total_size_bytes: 9999 });
  });
});
