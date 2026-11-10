import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  copyAddress,
  copyServerAddress,
  getInstalledDayzVersion,
  getMemoryMapStatus,
  getFilterFacets,
  getSearchSuggestions,
  passwordStatus,
  forgetPassword,
  launchGame,
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

describe("command names", () => {
  const rustCommands = (): string[] => {
    const source = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
    const handler = /generate_handler!\[([\s\S]*?)\]/.exec(source);
    if (handler === null) throw new Error("no generate_handler! list in lib.rs");
    return handler[1]
      .split(",")
      .map((entry) => entry.trim().split("::").pop() ?? "")
      .filter(Boolean);
  };

  const invokedCommands = (): { names: string[]; sites: number } => {
    const names: string[] = [];
    let sites = 0;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
          const source = readFileSync(path, "utf8");
          sites += source.match(/\binvoke\s*[<(]/g)?.length ?? 0;
          for (const match of source.matchAll(/invoke(?:<.*?>)?\(\s*"([a-z0-9_]+)"/g)) {
            names.push(match[1]);
          }
        }
      }
    };
    walk(fileURLToPath(new URL("..", import.meta.url)));
    return { names, sites };
  };

  it("only invokes commands the Rust side registers", () => {
    const registered = new Set(rustCommands());
    const { names, sites } = invokedCommands();
    expect(names).toHaveLength(sites);
    expect([...new Set(names)].filter((name) => !registered.has(name))).toEqual([]);
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
