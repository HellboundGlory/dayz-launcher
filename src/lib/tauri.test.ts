import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  copyAddress,
  copyServerAddress,
  checkServerMods,
  getUniqueModsSummary,
  unsubscribeUniqueMods,
  getFilterFacets,
  getSearchSuggestions,
  getInstalledDayzVersion,
  passwordStatus,
  forgetPassword,
  launchGame,
  getMemoryMapStatus,
  type FilterParams,
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

  it.each([
    { host: "192.168.1.50", gamePort: 2302, want: "192.168.1.50:2302" },
    { host: "192.168.1.50:27016", gamePort: 2302, want: "192.168.1.50:2302" },
    { host: "2001:db8::1:27016", gamePort: 2302, want: "2001:db8::1:2302" },
  ])("copyAddress writes $host as $want", async ({ host, gamePort, want }) => {
    await copyAddress(host, gamePort);
    expect(writtenText).toBe(want);
  });

  it("copyServerAddress copies the server's address with its game port", async () => {
    await copyServerAddress({ addr: "10.0.0.1:27016", game_port: 2303 });
    expect(writtenText).toBe("10.0.0.1:2303");
  });
});

describe("server mods tauri command wrappers", () => {
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

describe("getInstalledDayzVersion", () => {
  it("passes the folder override and returns the reported version", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1.29.163709");
    await expect(getInstalledDayzVersion("/games/DayZ")).resolves.toBe("1.29.163709");
    expect(invoke).toHaveBeenCalledWith("get_installed_dayz_version", { dayzPathOverride: "/games/DayZ" });
  });

  it("returns null when the command rejects", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("folder unreadable"));
    await expect(getInstalledDayzVersion(null)).resolves.toBeNull();
  });
});

describe("getMemoryMapStatus", () => {
  it("returns the limit the command reports", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ current: 65530, recommended: 1048576 });
    await expect(getMemoryMapStatus()).resolves.toEqual({ current: 65530, recommended: 1048576 });
    expect(invoke).toHaveBeenCalledWith("get_memory_map_status");
  });

  it.each([
    { name: "no warning is needed", resolved: null },
    { name: "the command rejects", resolved: new Error("unreadable") },
  ])("returns null when $name", async ({ resolved }) => {
    if (resolved instanceof Error) vi.mocked(invoke).mockRejectedValueOnce(resolved);
    else vi.mocked(invoke).mockResolvedValueOnce(resolved);
    await expect(getMemoryMapStatus()).resolves.toBeNull();
  });
});

describe("facet and suggestion calls send the filter as filterParams", () => {
  const filter = {} as FilterParams;

  it.each([
    {
      name: "getFilterFacets without a version",
      call: () => getFilterFacets(filter),
      command: "get_filter_facets",
      args: { filterParams: filter, myVersion: null },
      resolved: {
        total: 8,
        maps: [],
        versions: [],
        countries: [],
        mods: [],
        same_as_mine: null,
      },
    },
    {
      name: "getFilterFacets with a version",
      call: () => getFilterFacets(filter, "1.29.1"),
      command: "get_filter_facets",
      args: { filterParams: filter, myVersion: "1.29.1" },
      resolved: {
        total: 2,
        maps: [],
        versions: [],
        countries: [],
        mods: [],
        same_as_mine: 2,
      },
    },
    {
      name: "getSearchSuggestions",
      call: () => getSearchSuggestions(filter, "nam"),
      command: "get_search_suggestions",
      args: { filterParams: filter, text: "nam" },
      resolved: [
        { kind: "map", label: "Namalsk", count: 1, values: ["namalsk"] },
      ],
    },
  ])("$name invokes $command and returns what it resolved", async ({ call, command, args, resolved }) => {
    vi.mocked(invoke).mockResolvedValueOnce(resolved);
    const result = await call();
    expect(invoke).toHaveBeenCalledWith(command, args);
    expect(result).toEqual(resolved);
  });
});

describe("saved password commands", () => {
  it("passwordStatus invokes password_status with the address", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ saved: true, keyring: true });
    await expect(passwordStatus("1.2.3.4:27016")).resolves.toEqual({
      saved: true,
      keyring: true,
    });
    expect(invoke).toHaveBeenCalledWith("password_status", { addr: "1.2.3.4:27016" });
  });

  it("forgetPassword invokes forget_password with the address", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await forgetPassword("1.2.3.4:27016");
    expect(invoke).toHaveBeenCalledWith("forget_password", { addr: "1.2.3.4:27016" });
  });

  it("launchGame asks Rust to use the saved password only when told to", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ status: "launched" });
    await launchGame("1.2.3.4:27016", 2302, { useSavedPassword: true });
    expect(invoke).toHaveBeenCalledWith(
      "launch_game",
      expect.objectContaining({ useSaved: true }),
    );
  });

  it("launchGame sends the typed password and whether to remember it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ status: "launched" });
    await launchGame("1.2.3.4:27016", 2302, {
      password: "hunter2",
      rememberPassword: true,
    });
    expect(invoke).toHaveBeenCalledWith(
      "launch_game",
      expect.objectContaining({ password: "hunter2", remember: true }),
    );
  });
});
