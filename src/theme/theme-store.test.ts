/** The one-time localStorage -> file-backed migration, focused on the
 * `custom:<name>` -> installed-id remap a pre-migration selection depends on. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RADII, DEFAULT_SPACING, DEFAULT_TYPOGRAPHY, type Palette } from "./palette";
import { effectiveExtras, resolvedExtras, useThemeStore } from "./theme-store";
import type { ThemeFile } from "@/types/theme";

const backend = vi.hoisted(() => ({
  /** What `migrate_legacy_custom_themes` reports back, in input order. */
  migratedIds: [] as string[],
  /** Ids written through `set_active_theme_id`, in call order. */
  setActiveCalls: [] as (string | null)[],
  /** What `list_installed_themes` sees. */
  installed: [] as { id: string; name: string }[],
  /** The `tokens` object each `save_theme` call received, in call order. */
  savedTokens: [] as unknown[],
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
  saveTheme: async (_manifest: unknown, tokens: unknown) => void backend.savedTokens.push(tokens),
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
  backend.savedTokens.length = 0;
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

describe("theme extras", () => {
  const files = (tokens: unknown): Record<string, ThemeFile> => ({
    "local.partial": { id: "local.partial", name: "Partial", tokens } as ThemeFile,
  });

  it("fills the missing spacing keys of a partial theme from the defaults", () => {
    const themeFiles = files({ spacing: { md: "12px" } });

    const extras = resolvedExtras("local.partial", themeFiles);

    expect(extras.spacing).toEqual({ ...DEFAULT_SPACING, md: "12px" });
  });

  it("keeps the defaults for a preset and for a theme with no extras", () => {
    expect(resolvedExtras("ember", files({}))).toEqual({
      spacing: DEFAULT_SPACING,
      radii: DEFAULT_RADII,
      typography: DEFAULT_TYPOGRAPHY,
    });
    expect(resolvedExtras("local.partial", files({}))).toEqual({
      spacing: DEFAULT_SPACING,
      radii: DEFAULT_RADII,
      typography: DEFAULT_TYPOGRAPHY,
    });
  });

  it("ignores non-string values in an untrusted tokens.json", () => {
    const themeFiles = files({ spacing: { md: 12, lg: "20px" }, typography: null });

    expect(resolvedExtras("local.partial", themeFiles).spacing).toEqual({
      ...DEFAULT_SPACING,
      lg: "20px",
    });
  });

  it("lets a customExtras override beat both the theme's own value and the default", () => {
    const themeFiles = files({ spacing: { md: "12px" }, radii: { row: "2px" } });

    const extras = effectiveExtras("local.partial", themeFiles, {
      spacing: { md: "6px" },
      radii: {},
      typography: { uiFont: "Comic Sans" },
    });

    expect(extras.spacing).toEqual({ ...DEFAULT_SPACING, md: "6px" });
    expect(extras.radii).toEqual({ ...DEFAULT_RADII, row: "2px" });
    expect(extras.typography.uiFont).toBe("Comic Sans");
    expect(extras.typography.dataFont).toBe(DEFAULT_TYPOGRAPHY.dataFont);
  });

  it("passes the merged extras to applyTheme and clears them on reset", () => {
    const setProperty = vi.fn();
    vi.stubGlobal("document", { documentElement: { style: { setProperty } } });
    useThemeStore.setState({
      activeId: "local.partial",
      themeFiles: files({ spacing: { md: "12px" } }),
      customExtras: { spacing: { lg: "40px" }, radii: {}, typography: {} },
    });

    useThemeStore.getState().apply();
    expect(setProperty).toHaveBeenCalledWith("--space-lg", "40px");
    expect(setProperty).toHaveBeenCalledWith("--space-md", "12px");

    useThemeStore.getState().resetToBase();
    expect(setProperty).toHaveBeenCalledWith("--space-lg", DEFAULT_SPACING.lg);
    expect(useThemeStore.getState().customExtras).toEqual({
      spacing: {},
      radii: {},
      typography: {},
    });
  });

  it("persists the merged extras into a saved theme's tokens", async () => {
    useThemeStore.setState({
      activeId: "local.partial",
      themeFiles: files({ spacing: { md: "12px" } }),
      customExtras: { spacing: {}, radii: { chip: "1px" }, typography: {} },
    });

    await useThemeStore.getState().saveTheme("Extras skin");

    expect(backend.savedTokens).toHaveLength(1);
    const tokens = backend.savedTokens[0] as Record<string, unknown>;
    expect(tokens.spacing).toEqual({ ...DEFAULT_SPACING, md: "12px" });
    expect(tokens.radii).toEqual({ ...DEFAULT_RADII, chip: "1px" });
    expect(tokens.typography).toEqual(DEFAULT_TYPOGRAPHY);
  });
});
