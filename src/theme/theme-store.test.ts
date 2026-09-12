/** The one-time localStorage -> file-backed migration, focused on the
 * `custom:<name>` -> installed-id remap a pre-migration selection depends on. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Palette } from "./palette";
import { useThemeStore } from "./theme-store";

const backend = vi.hoisted(() => ({
  /** What `migrate_legacy_custom_themes` reports back, in input order. */
  migratedIds: [] as string[],
  /** Ids written through `set_active_theme_id`, in call order. */
  setActiveCalls: [] as (string | null)[],
  /** What `list_installed_themes` sees. */
  installed: [] as { id: string; name: string }[],
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@/lib/tauri", () => ({
  listInstalledThemes: async () => backend.installed,
  getTheme: async (id: string) => ({ id, name: id, tokens: {} }),
  getSettings: async () => ({ activeThemeId: null }),
  setActiveThemeId: async (id: string | null) => void backend.setActiveCalls.push(id),
  migrateLegacyCustomThemes: async () => backend.migratedIds,
  armActivation: async () => {},
  saveTheme: async () => "",
  deleteTheme: async () => {},
}));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
});

// applyTheme writes straight onto the document element's style.
vi.stubGlobal("document", { documentElement: { style: { setProperty: () => {} } } });

const PALETTE = { bg: "#101010" } as Palette;

beforeEach(() => {
  storage.clear();
  backend.migratedIds.length = 0;
  backend.setActiveCalls.length = 0;
  backend.installed = [];
  useThemeStore.setState({ activeId: "neutral" });
});

describe("hydrate legacy migration", () => {
  it("remaps a stored custom:<name> selection onto the id the migration created", async () => {
    storage.set(
      "tetra.customThemes",
      JSON.stringify([{ name: "Foo", dark: PALETTE, light: PALETTE }]),
    );
    storage.set(
      "tetra.themeActive",
      JSON.stringify({ activeId: "custom:Foo", scheme: "dark", bloom: 0.9 }),
    );
    // The id the backend actually created, as it reports it back.
    backend.migratedIds.push("local.foo");
    backend.installed = [{ id: "local.foo", name: "Foo" }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("local.foo");
    expect(backend.setActiveCalls).toEqual(["local.foo"]);
    expect(storage.has("tetra.customThemes")).toBe(false);
  });

  it("drops the old key even when the migration returns nothing", async () => {
    storage.set(
      "tetra.customThemes",
      JSON.stringify([{ name: "Foo", dark: PALETTE, light: PALETTE }]),
    );
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "custom:Foo" }));

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("neutral");
    expect(storage.has("tetra.customThemes")).toBe(false);
  });

  it("falls back to neutral for a stored custom:<name> that nothing resolves to", async () => {
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "custom:Gone" }));

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("neutral");
    expect(backend.setActiveCalls).toEqual([]);
  });

  it("keeps a stored preset selection and persists it once", async () => {
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "ember", scheme: "light", bloom: 0.5 }));

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("ember");
    expect(useThemeStore.getState().scheme).toBe("light");
    expect(useThemeStore.getState().bloom).toBe(0.5);
    expect(backend.setActiveCalls).toEqual(["ember"]);
  });
});
