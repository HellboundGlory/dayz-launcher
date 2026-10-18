/** The one-time localStorage -> file-backed migration, focused on the
 * `custom:<name>` -> installed-id remap a pre-migration selection depends on. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTRAS } from "./apply";
import { useDevStore } from "./dev/dev-store";
import {
  NEUTRAL_DARK,
  NEUTRAL_LIGHT,
  type Palette,
} from "./palette";
import {
  effectiveRoleValues,
  getActiveLayout,
  getThemeOwnedLayout,
  mergeSettingsValues,
  resolvedExtras,
  useThemeStore,
  watchHotReload,
  watchThemeActivationReverted,
} from "./theme-store";
import { clearFallbackMemory, isFileFallenBack, useFallbackStore } from "./fallback/store";
import type { ThemeFile, ThemeSettings, ThemeSummary, ValidationIssue } from "@/types/theme";
import { NEUTRAL_TOKENS, parseTokens } from "./tokens";
import { getNeutralLayout } from "./neutral";
import type { LayoutFile } from "./renderer/types";
import { nextDuplicateName } from "@/components/themes-page/theme-grid";

const backend = vi.hoisted(() => ({
  /** What `migrate_legacy_custom_themes` reports back, one entry per input theme. */
  migratedIds: [] as (string | null)[],
  /** Ids written through `set_active_theme_id`, in call order. */
  setActiveCalls: [] as (string | null)[],
  /** What `list_installed_themes` sees. */
  installed: [] as { id: string; name: string; incompatible?: boolean }[],
  /** Every `save_theme_copy` call, in order. */
  copies: [] as { name: string; sourceId: string | null; tokens: unknown; replace: boolean }[],
  /** What the next `save_theme_copy` answers: the backend picks the id and reports clashes. */
  copyResult: { status: "saved", id: "local.copy" } as { status: "saved" | "exists"; id: string },
  /** Ids `delete_theme` was asked for, in call order. */
  deleted: [] as string[],
  /** Every `arm_activation` call's id and `deleteOnRevert`, in order. */
  armed: [] as { id: string | null; deleteOnRevert: boolean }[],
  /** Every `update_theme_tokens` call, in order. */
  updatedTokens: [] as { id: string; tokens: unknown }[],
  /** `tokens.json` contents `get_theme` returns, by id. */
  tokensById: {} as Record<string, unknown>,
  /** Layout files `get_theme` returns, by id. */
  layoutsById: {} as Record<string, Record<string, LayoutFile>>,
  /** Files `get_theme` reports as dropped, by id. */
  fallbacksById: {} as Record<string, ValidationIssue[]>,
  /** `settings.values.json` contents `get_theme_settings_values` returns, by id. */
  settingsById: {} as Record<string, Record<string, unknown>>,
  /** The resolved settings `get_theme` returns, by id. */
  themeSettingsById: {} as Record<string, ThemeSettings>,
  /** Every `set_theme_settings_value` call, in order. */
  setSettingsCalls: [] as { id: string; fieldId: string; value: string | number | boolean }[],
  /** When set, `set_theme_settings_value` rejects with this message. */
  settingsSaveError: null as string | null,
  /** Ids `get_theme` was asked for, in call order. */
  themeCalls: [] as string[],
  /** `validate_theme` issues to return, by id; missing means no issues. */
  validationIssuesById: {} as Record<string, ValidationIssue[]>,
  /** ids for which `validate_theme` rejects with this message instead. */
  validateErrorsById: {} as Record<string, string>,
  /** Ids `validate_theme` was asked for, in call order. */
  validateCalls: [] as string[],
  /** ids for which `get_theme` rejects with this message instead of resolving. */
  getThemeErrorsById: {} as Record<string, string>,
}));

const events = vi.hoisted(() => ({
  /** The handler `watchThemeActivationReverted` registered, if any. */
  reverted: null as
    | ((event: { payload: { previousId: string | null } }) => void)
    | null,
  /** The handler `watchHotReload` registered, if any. */
  hotReload: null as ((event: { payload: { id: string } }) => void) | null,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (
    name: string,
    handler: (event: { payload: { previousId: string | null } }) => void,
  ) => {
    if (name === "theme-hot-reload") {
      events.hotReload = handler as unknown as (event: { payload: { id: string } }) => void;
    } else {
      events.reverted = handler;
    }
    return Promise.resolve(() => {});
  },
}));

vi.mock("@/lib/tauri", () => ({
  listInstalledThemes: async () => backend.installed,
  getTheme: async (id: string) => {
    backend.themeCalls.push(id);
    if (backend.getThemeErrorsById[id] !== undefined) {
      throw new Error(backend.getThemeErrorsById[id]);
    }
    return {
      id,
      name: id,
      tokens: backend.tokensById[id] ?? {},
      settings: backend.themeSettingsById[id] ?? null,
      layouts: backend.layoutsById[id] ?? {},
      fallbacks: backend.fallbacksById[id] ?? [],
    };
  },
  getSettings: async () => ({ activeThemeId: null }),
  setActiveThemeId: async (id: string | null) => void backend.setActiveCalls.push(id),
  migrateLegacyCustomThemes: async () => backend.migratedIds,
  armActivation: async (id: string | null, deleteOnRevert = false) =>
    void backend.armed.push({ id, deleteOnRevert }),
  saveThemeCopy: async (name: string, sourceId: string | null, tokens: unknown, replace: boolean) => {
    backend.copies.push({ name, sourceId, tokens, replace });
    return backend.copyResult;
  },
  updateThemeTokens: async (id: string, tokens: unknown) => {
    backend.updatedTokens.push({ id, tokens });
    // The real command rewrites the file; `getTheme` re-reads what it wrote.
    backend.tokensById[id] = tokens;
  },
  deleteTheme: async (id: string) => void backend.deleted.push(id),
  getThemeSettingsValues: async (id: string) => backend.settingsById[id] ?? {},
  setThemeSettingsValue: async (id: string, fieldId: string, value: string | number | boolean) => {
    if (backend.settingsSaveError !== null) throw new Error(backend.settingsSaveError);
    backend.setSettingsCalls.push({ id, fieldId, value });
  },
  validateTheme: async (id: string) => {
    backend.validateCalls.push(id);
    if (backend.validateErrorsById[id] !== undefined) {
      throw new Error(backend.validateErrorsById[id]);
    }
    return backend.validationIssuesById[id] ?? [];
  },
}));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
});

// applyTheme writes straight onto the document element's style; applyThemeStylesheet
// touches head, so the stub covers that.
interface StubLink {
  attributes: Record<string, string>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
}
/** Every `--token` applyTheme wrote, most recent write per token. */
const writtenProps: Record<string, string> = {};
const themeCssHead: StubLink[] = [];
vi.stubGlobal("document", {
  documentElement: {
    style: {
      setProperty: (name: string, value: string) => void (writtenProps[name] = value),
    },
  },
  head: { appendChild: (el: StubLink) => void themeCssHead.push(el) },
  getElementById: (id: string) => themeCssHead.find((el) => el.getAttribute("id") === id) ?? null,
  createElement: (): StubLink => {
    const el: StubLink = {
      attributes: {},
      getAttribute: (name) => el.attributes[name] ?? null,
      setAttribute: (name, value) => void (el.attributes[name] = value),
      remove: () => void themeCssHead.splice(themeCssHead.indexOf(el), 1),
    };
    return el;
  },
});

const PALETTE = { bg: "#101010" } as Palette;

beforeEach(() => {
  storage.clear();
  backend.migratedIds.length = 0;
  backend.setActiveCalls.length = 0;
  backend.installed = [];
  backend.copies.length = 0;
  backend.copyResult = { status: "saved", id: "local.copy" };
  backend.deleted.length = 0;
  backend.armed.length = 0;
  backend.updatedTokens.length = 0;
  backend.tokensById = {};
  backend.layoutsById = {};
  backend.fallbacksById = {};
  backend.settingsById = {};
  backend.themeSettingsById = {};
  backend.setSettingsCalls.length = 0;
  backend.settingsSaveError = null;
  backend.themeCalls.length = 0;
  backend.validationIssuesById = {};
  backend.validateErrorsById = {};
  backend.validateCalls.length = 0;
  backend.getThemeErrorsById = {};
  themeCssHead.length = 0;
  for (const name of Object.keys(writtenProps)) delete writtenProps[name];
  useThemeStore.setState({
    activeId: "neutral",
    themeFiles: {},
    settingsValues: {},
    customExtras: { radius: {}, family: {} },
    incompatibleSwitch: null,
  });
  clearFallbackMemory();
  useDevStore.getState().clear();
});

/** Two microtask turns: enough for async operations to settle. */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** An installed theme's grid summary, as `list_installed_themes` reports one. */
function summary(id: string, name: string): ThemeSummary {
  return {
    id,
    name,
    author: "local",
    version: "1.0.0",
    themeApi: "2.0",
    minimumLauncherVersion: "0.0.0",
    tier: "",
    description: "",
    preview: null,
    tags: [],
    capabilities: ["tokens"],
  };
}

describe("hydrate legacy migration", () => {
  it("remaps a stored custom:<name> selection onto the id the migration created", async () => {
    storage.set(
      "tetra.customThemes",
      JSON.stringify([
        { name: "Ёлка", dark: PALETTE, light: PALETTE },
        { name: "Звезда", dark: PALETTE, light: PALETTE },
      ]),
    );
    storage.set(
      "tetra.themeActive",
      JSON.stringify({ activeId: "custom:Звезда", scheme: "dark", bloom: 0.9 }),
    );
    // One entry per input theme, in input order; the first was not written.
    backend.migratedIds.push(null, "local.theme-2");
    backend.installed = [{ id: "local.theme-2", name: "Звезда" }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("local.theme-2");
    expect(backend.setActiveCalls).toEqual(["local.theme-2"]);
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

  it("keeps a stored installed-theme selection and persists it once", async () => {
    storage.set(
      "tetra.themeActive",
      JSON.stringify({ activeId: "local.foo", scheme: "light", bloom: 0.5 }),
    );
    backend.installed = [{ id: "local.foo", name: "Foo" }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("local.foo");
    expect(useThemeStore.getState().scheme).toBe("light");
    expect(useThemeStore.getState().bloom).toBe(0.5);
    expect(backend.setActiveCalls).toEqual(["local.foo"]);
  });
});

describe("hydrate incompatible fallback", () => {
  it("falls back to neutral when the stored active theme is reported incompatible", async () => {
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "local.old" }));
    backend.installed = [{ id: "local.old", name: "Old", incompatible: true }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("neutral");
  });

  it("records the switched-off theme and persists the switch to neutral", async () => {
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "local.old" }));
    backend.installed = [{ id: "local.old", name: "Old Timer", incompatible: true }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("neutral");
    expect(useThemeStore.getState().incompatibleSwitch).toEqual({
      id: "local.old",
      name: "Old Timer",
    });
    expect(backend.setActiveCalls).toContain("neutral");
  });

  it("does not record the switch again for a theme whose notice was already handled", async () => {
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "local.old" }));
    storage.set("tetra.incompatibleNoticeShown.local.old", "true");
    backend.installed = [{ id: "local.old", name: "Old Timer", incompatible: true }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("neutral");
    expect(useThemeStore.getState().incompatibleSwitch).toBeNull();
  });

  it("leaves activeId alone when the stored active theme is not incompatible", async () => {
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "local.fine" }));
    backend.installed = [{ id: "local.fine", name: "Fine" }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("local.fine");
    expect(useThemeStore.getState().incompatibleSwitch).toBeNull();
  });

  it("dismissing clears the switch and records the notice under the theme's id", () => {
    useThemeStore.setState({ incompatibleSwitch: { id: "local.old", name: "Old Timer" } });

    useThemeStore.getState().dismissIncompatibleSwitch();

    expect(useThemeStore.getState().incompatibleSwitch).toBeNull();
    expect(storage.get("tetra.incompatibleNoticeShown.local.old")).toBe("true");
  });
});

describe("theme extras", () => {
  const files = (tokens: unknown): Record<string, ThemeFile> => ({
    "local.partial": { id: "local.partial", name: "Partial", tokens } as ThemeFile,
  });

  it("applies installed v2 roles without overriding live palette edits or bloom", () => {
    const themeFiles = files({ schemaVersion: 2, bloom: 0.2, colors: { dark: { accent: "#ff0000" } }, scales: { radius: { md: "9px" } }, roles: { space: { rowX: "18" } } });
    expect(resolvedExtras("local.partial", themeFiles).shadows.glowIntensity).toBe(0.2);
    useThemeStore.setState({ activeId: "local.partial", scheme: "dark", themeFiles, custom: { dark: { accent: "#00ff00" }, light: {} }, bloom: 0.4 });
    useThemeStore.getState().apply();
    expect(writtenProps["--accent"]).toBe("#00ff00");
    expect(writtenProps["--bloom"]).toBe("0.4");
    expect(writtenProps["--t-radius-control"]).toBe("9px");
    expect(writtenProps["--t-space-rowX"]).toBe("18px");
    useThemeStore.setState({ activeId: "neutral" });
    useThemeStore.getState().apply();
    expect(writtenProps["--t-radius-control"]).toBe("6px");
    expect(writtenProps["--t-space-rowX"]).toBe("12px");
  });

  it("keeps the defaults for a preset and for a theme with no tokens", () => {
    expect(resolvedExtras("neutral", files({}))).toEqual(DEFAULT_EXTRAS);
    expect(resolvedExtras("local.partial", files({}))).toEqual(DEFAULT_EXTRAS);
  });

  it("reads a numeric glowIntensity and drops a non-numeric one", () => {
    expect(
      resolvedExtras("local.partial", files({ shadows: { glowIntensity: 0.4 } })).shadows,
    ).toEqual({ glowIntensity: 0.4 });
    expect(
      resolvedExtras("local.partial", files({ shadows: { glowIntensity: "0.4" } })).shadows,
    ).toEqual({ glowIntensity: DEFAULT_EXTRAS.shadows.glowIntensity });
    expect(resolvedExtras("local.partial", files({ shadows: null })).shadows).toEqual({
      glowIntensity: DEFAULT_EXTRAS.shadows.glowIntensity,
    });
  });

  it("shows Neutral's resolved roles for a theme with no v2 tokens", () => {
    expect(effectiveRoleValues("local.partial", files({}), { radius: {}, family: {} })).toEqual({
      radius: { window: "8px", panel: "9px", row: "8px", control: "6px" },
      family: {
        ui: NEUTRAL_TOKENS.scales.type.family.ui,
        data: NEUTRAL_TOKENS.scales.type.family.data,
      },
    });
  });

  it("resolves the theme's own roles through its scales, with the editor override winning", () => {
    const themeFiles = files({
      schemaVersion: 2,
      scales: { radius: { md: "9px" } },
      roles: { radius: { row: "md" } },
    });

    const roles = effectiveRoleValues("local.partial", themeFiles, { radius: { row: "2px" }, family: {} });

    expect(roles.radius).toEqual({ window: "8px", panel: "9px", row: "2px", control: "9px" });
  });

  it("writes an editor role override into the v2 variables, and stops writing the legacy ones", () => {
    useThemeStore.setState({
      activeId: "neutral",
      customExtras: { radius: { row: "14px" }, family: { ui: "Comic Sans" } },
    });

    useThemeStore.getState().apply();

    expect(writtenProps["--t-radius-row"]).toBe("14px");
    expect(writtenProps["--t-type-family-ui"]).toBe("Comic Sans");
    // The type roles name that family step, so they pick the override up too.
    expect(writtenProps["--t-type-body-family"]).toBe("Comic Sans");
    // Everything else keeps Neutral's own value.
    expect(writtenProps["--t-radius-control"]).toBe("6px");
    expect(writtenProps["--t-type-family-data"]).toBe(NEUTRAL_TOKENS.scales.type.family.data);
    for (const dead of ["--space-md", "--radius-row", "--font-ui", "--font-data"]) {
      expect(writtenProps[dead]).toBeUndefined();
    }
  });

  it("passes the live bloom to applyTheme, and clears the role overrides on reset", () => {
    useThemeStore.setState({
      activeId: "neutral",
      customExtras: { radius: { row: "40px" }, family: { data: "Comic Sans" } },
      bloom: 0.35,
    });

    useThemeStore.getState().apply();
    expect(writtenProps["--t-radius-row"]).toBe("40px");
    expect(writtenProps["--t-type-family-data"]).toBe("Comic Sans");
    // The slider's live value renders; the theme's own glowIntensity only
    // seeds it at pick time.
    expect(writtenProps["--bloom"]).toBe("0.35");

    useThemeStore.getState().resetToBase();
    expect(writtenProps["--t-radius-row"]).toBe("8px");
    expect(useThemeStore.getState().customExtras).toEqual({ radius: {}, family: {} });
  });
});

describe("saveTheme in place", () => {
  const themeFile = (id: string, tokens: unknown): ThemeFile =>
    ({ id, name: id, tokens, settings: null, layouts: {} }) as unknown as ThemeFile;

  it("rewrites an installed user theme's tokens instead of creating a new theme", async () => {
    const sourceTokens = {
      schemaVersion: 2,
      bloom: 0.2,
      colors: { dark: { bg: "#010101" } },
      scales: { radius: { md: "9px" } },
      roles: { radius: { row: "9px" } },
    };
    backend.installed = [summary("local.mine", "Mine")];
    useThemeStore.setState({
      activeId: "local.mine",
      installedThemes: [summary("local.mine", "Mine")],
      themeFiles: { "local.mine": themeFile("local.mine", sourceTokens) },
      custom: { dark: { accent: "#00ff00" }, light: {} },
      customExtras: { radius: { row: "3px" }, family: { ui: "Comic Sans" } },
      bloom: 0.42,
    });

    await useThemeStore.getState().saveTheme("Renamed");

    expect(backend.updatedTokens.map((c) => c.id)).toEqual(["local.mine"]);
    // Nothing is created: the in-place path never reaches `save_theme_copy`.
    expect(backend.copies).toHaveLength(0);

    // The tokens `duplicateTheme` would have written, aimed at the same id:
    // the live colours and bloom, and the role overrides merged into the
    // theme's own scales and roles.
    const tokens = parseTokens(backend.updatedTokens[0].tokens);
    expect(tokens.schemaVersion).toBe(2);
    expect(tokens.colors?.dark).toEqual({ ...NEUTRAL_DARK, bg: "#010101", accent: "#00ff00" });
    expect(tokens.colors?.light).toEqual(NEUTRAL_LIGHT);
    expect(tokens.bloom).toBe(0.42);
    expect(tokens.scales).toEqual({
      radius: { md: "9px" },
      type: { family: { ui: "Comic Sans" } },
    });
    expect(tokens.roles).toEqual({ radius: { row: "3px" } });

    // The cache is refreshed from the file the write left behind, and the
    // overrides clear — they are the theme's own values now.
    expect(backend.themeCalls).toContain("local.mine");
    expect(useThemeStore.getState().themeFiles["local.mine"].tokens).toEqual(
      backend.updatedTokens[0].tokens,
    );
    const state = useThemeStore.getState();
    expect(state.custom).toEqual({ dark: {}, light: {} });
    expect(state.customExtras).toEqual({ radius: {}, family: {} });
    expect(state.lightRefined).toBe(false);
  });

  it("duplicates when the active theme is not a user theme", async () => {
    backend.installed = [summary("builtin.tactical", "Tactical")];
    useThemeStore.setState({
      activeId: "builtin.tactical",
      installedThemes: [summary("builtin.tactical", "Tactical")],
      themeFiles: { "builtin.tactical": themeFile("builtin.tactical", { schemaVersion: 2 }) },
    });

    await useThemeStore.getState().saveTheme("Tactical copy");

    expect(backend.updatedTokens).toHaveLength(0);
    // The backend copies the active theme's layout and CSS from its folder.
    expect(backend.copies).toHaveLength(1);
    expect(backend.copies[0]).toMatchObject({ name: "Tactical copy", sourceId: "builtin.tactical" });
  });
});

describe("duplicateTheme", () => {
  const themeFile = (tokens: unknown): ThemeFile =>
    ({
      id: "local.source",
      name: "Source",
      tokens,
      settings: null,
      layouts: {},
    }) as unknown as ThemeFile;

  it("sends a v2 palette built from the source's scales and roles and the live edits", async () => {
    const sourceTokens = {
      schemaVersion: 2,
      bloom: 0.2,
      colors: { dark: { bg: "#010101" } },
      scales: { radius: { md: "9px" } },
      roles: { radius: { row: "9px" } },
    };
    useThemeStore.setState({
      activeId: "local.source",
      themeFiles: { "local.source": themeFile(sourceTokens) },
      custom: { dark: { accent: "#00ff00" }, light: {} },
      bloom: 0.42,
    });

    await useThemeStore.getState().saveTheme("Extras skin");

    expect(backend.copies[0]).toMatchObject({ name: "Extras skin", sourceId: "local.source", replace: false });

    // `parseTokens` is the same validation the backend's TokensV2 applies: a
    // shape it rejects would throw here.
    const tokens = parseTokens(backend.copies[0].tokens);
    expect(tokens.schemaVersion).toBe(2);
    // The source's own scales/roles carry over...
    expect(tokens.scales).toEqual({ radius: { md: "9px" } });
    expect(tokens.roles).toEqual({ radius: { row: "9px" } });
    // ...its palette arrives with the live colour edit, and the live bloom.
    expect(tokens.colors?.dark).toEqual({ ...NEUTRAL_DARK, bg: "#010101", accent: "#00ff00" });
    expect(tokens.colors?.light).toEqual(NEUTRAL_LIGHT);
    expect(tokens.bloom).toBe(0.42);
  });

  it("falls back to Neutral's scales and roles for a palette-only source, and keeps its bloom", async () => {
    useThemeStore.setState({
      activeId: "neutral",
      themeFiles: { "local.old": themeFile({ shadows: { glowIntensity: 0.3 } }) },
      bloom: 0.42,
    });

    await useThemeStore.getState().duplicateTheme("local.old", "Copy");

    const tokens = parseTokens(backend.copies[0].tokens);
    expect(tokens.schemaVersion).toBe(2);
    expect(tokens.scales).toEqual(NEUTRAL_TOKENS.scales);
    expect(tokens.roles).toEqual(NEUTRAL_TOKENS.roles);
    // The source's own bloom, not the slider's — only the live theme takes the slider.
    expect(tokens.bloom).toBe(0.3);
  });

  it("writes the live editor role overrides into the saved tokens", async () => {
    useThemeStore.setState({
      activeId: "local.source",
      themeFiles: { "local.source": themeFile({ schemaVersion: 2, roles: { radius: { row: "9px" } } }) },
      customExtras: { radius: { window: "2px", row: "3px" }, family: { ui: "Comic Sans" } },
    });

    await useThemeStore.getState().saveTheme("Role skin");

    const tokens = parseTokens(backend.copies[0].tokens);
    expect(tokens.roles).toEqual({ radius: { row: "3px", window: "2px" } });
    expect(tokens.scales?.type?.family).toEqual({
      ...NEUTRAL_TOKENS.scales.type.family,
      ui: "Comic Sans",
    });
  });

  it("keeps the editor's role overrides out of a copy of another theme", async () => {
    useThemeStore.setState({
      activeId: "neutral",
      themeFiles: { "local.source": themeFile({ schemaVersion: 2, roles: { radius: { row: "9px" } } }) },
      customExtras: { radius: { row: "3px" }, family: { ui: "Comic Sans" } },
    });

    await useThemeStore.getState().duplicateTheme("local.source", "Copy");

    const tokens = parseTokens(backend.copies[0].tokens);
    expect(tokens.roles).toEqual({ radius: { row: "9px" } });
    expect(tokens.scales).toEqual(NEUTRAL_TOKENS.scales);
  });

  it("reports a taken name without writing or switching themes", async () => {
    backend.copyResult = { status: "exists", id: "local.copy" };
    useThemeStore.setState({
      activeId: "neutral",
      themeFiles: { "local.source": themeFile({ schemaVersion: 2 }) },
    });

    const result = await useThemeStore.getState().duplicateTheme("local.source", "Copy");

    expect(result).toBe("exists");
    expect(backend.copies[0]).toMatchObject({ name: "Copy", replace: false });
    expect(backend.armed).toEqual([]);
  });

  it("marks a fresh duplicate for deletion on revert but not a replacement", async () => {
    backend.copyResult = { status: "saved", id: "local.fresh" };
    await useThemeStore.getState().duplicateTheme("local.source", "Fresh");
    backend.copyResult = { status: "saved", id: "local.copy" };
    await useThemeStore.getState().duplicateTheme("local.source", "Copy", { overwrite: true });

    expect(backend.copies.map((call) => call.replace)).toEqual([false, true]);
    expect(backend.armed).toEqual([
      { id: "local.fresh", deleteOnRevert: true },
      { id: "local.copy", deleteOnRevert: false },
    ]);
  });

  it("creates a copy without switching to it when asked", async () => {
    useThemeStore.setState({
      activeId: "neutral",
      themeFiles: { "local.source": themeFile({ schemaVersion: 2 }) },
    });

    const result = await useThemeStore
      .getState()
      .duplicateTheme("local.source", "Copy", { activate: false });

    expect(result).toBe("saved");
    expect(backend.copies).toHaveLength(1);
    expect(useThemeStore.getState().activeId).toBe("neutral");
    expect(backend.setActiveCalls).toEqual([]);
  });
});

describe("nextDuplicateName", () => {
  it("suffixes a name that is already taken, compared as a name", () => {
    expect(nextDuplicateName("Neutral", ["neutral copy"])).toBe("Neutral copy 2");
    // Two names that differ only in punctuation are different names.
    expect(nextDuplicateName("Some", ["Some copy!"])).toBe("Some copy");
  });
});

describe("apply() asset wiring", () => {
  const installed = (id: string, capabilities: string[]) => {
    backend.installed = [{ id, name: id }];
    return {
      id,
      name: id,
      capabilities,
    } as ThemeFile;
  };

  it("applies the active theme's stylesheet, then unloads it on a theme without css", () => {
    const loaded = installed("local.aurora", ["tokens", "css"]);
    useThemeStore.setState({ activeId: "local.aurora", themeFiles: { "local.aurora": loaded } });

    useThemeStore.getState().apply();
    expect(themeCssHead.map((el) => el.attributes.href)).toEqual([
      "tetra-theme://localhost/local.aurora/theme-layer.css",
    ]);

    useThemeStore.getState().setScheme("light");
    expect(themeCssHead).toHaveLength(1);

    // Neutral has no ThemeFile at all: nothing may stay applied.
    useThemeStore.setState({ activeId: "neutral", themeFiles: {} });
    useThemeStore.getState().apply();
    expect(themeCssHead).toHaveLength(0);
  });
});

describe("settings values", () => {
  const SETTINGS: ThemeSettings = {
    fields: [
      { id: "accentHue", type: "number", label: "Accent hue", min: 0, max: 360, default: 210 },
      { id: "compactRows", type: "boolean", label: "Compact rows", default: false },
    ],
    combinations: [],
    capped: false,
  };

  /** A theme whose palette is templated on the two fields above. Both
   * schemes are templated so an assertion holds whichever one is active. */
  const templated = (id: string) => {
    backend.installed = [{ id, name: id }];
    backend.themeSettingsById[id] = SETTINGS;
    backend.tokensById[id] = {
      schemaVersion: 2,
      colors: {
        dark: { accent: "hsl({{accentHue}}, 45%, 60%)" },
        light: { accent: "hsl({{accentHue}}, 45%, 60%)" },
      },
      roles: { radius: { row: "{{accentHue}}px" } },
    };
    return id;
  };

  it("fills every field from the schema's own default, letting a tuned value win", () => {
    const fields = [
      { id: "accentHue", type: "number" as const, label: "Accent hue", min: 0, max: 360, default: 210 },
      { id: "compactRows", type: "boolean" as const, label: "Compact rows", default: false },
      {
        id: "fontMode",
        type: "choice" as const,
        label: "Font Mode",
        options: [
          { value: "sans", label: "Sans-Serif" },
          { value: "mono", label: "Monospace" },
        ],
        default: "sans",
      },
      { id: "primaryColor", type: "color" as const, label: "Primary Color", default: "#123456" },
    ];

    expect(
      mergeSettingsValues(fields, {
        accentHue: 300,
        compactRows: true,
        fontMode: "mono",
        primaryColor: "#ff0000",
      }),
    ).toEqual({
      accentHue: 300,
      compactRows: true,
      fontMode: "mono",
      primaryColor: "#ff0000",
    });
  });

  it("treats wrong-typed, out-of-bounds, or invalid option values as untuned", () => {
    const fields = [
      { id: "accentHue", type: "number" as const, label: "Accent hue", min: 0, max: 360, default: 210 },
      { id: "compactRows", type: "boolean" as const, label: "Compact rows", default: false },
      {
        id: "fontMode",
        type: "choice" as const,
        label: "Font Mode",
        options: [
          { value: "sans", label: "Sans-Serif" },
          { value: "mono", label: "Monospace" },
        ],
        default: "sans",
      },
      { id: "primaryColor", type: "color" as const, label: "Primary Color", default: "#123456" },
    ];

    expect(
      mergeSettingsValues(fields, {
        accentHue: 400,
        compactRows: "true",
        fontMode: "serif",
        primaryColor: "invalid",
        gone: 1,
      }),
    ).toEqual({
      accentHue: 210,
      compactRows: false,
      fontMode: "sans",
      primaryColor: "#123456",
    });
  });

  it("paints a picked theme's tuned values on the activation itself", async () => {
    const id = templated("local.tuned");
    backend.settingsById[id] = { accentHue: 300 };

    await useThemeStore.getState().pickTheme(id);

    expect(useThemeStore.getState().settingsValues[id]).toEqual({
      accentHue: 300,
      compactRows: false,
    });
    expect(writtenProps["--accent"]).toBe("hsl(300, 45%, 60%)");
    expect(writtenProps["--t-radius-row"]).toBe("300px");
  });

  it("renders a never-tuned field as its schema default, not literal or undefined", async () => {
    const id = templated("local.untuned");

    await useThemeStore.getState().pickTheme(id);

    // A complete values object always reaches substitution: the untuned field
    // carries its own default, which is what renders.
    expect(writtenProps["--accent"]).toBe("hsl(210, 45%, 60%)");
    expect(writtenProps["--t-radius-row"]).toBe("210px");
  });

  it("writes a tuned value through and repaints from it without re-reading", async () => {
    const id = templated("local.tuned");
    backend.settingsById[id] = {};
    await useThemeStore.getState().pickTheme(id);

    await useThemeStore.getState().setSettingsValue(id, "accentHue", 42);

    expect(backend.setSettingsCalls).toEqual([{ id, fieldId: "accentHue", value: 42 }]);
    expect(writtenProps["--accent"]).toBe("hsl(42, 45%, 60%)");
  });

  it("reports a failed save and leaves the stored value unchanged", async () => {
    const id = templated("local.failingSave");
    await useThemeStore.getState().pickTheme(id);
    const before = useThemeStore.getState().settingsValues[id];
    backend.settingsSaveError = "disk full";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const saved = await useThemeStore.getState().setSettingsValue(id, "accentHue", 42);

    expect(saved).toBe(false);
    expect(useThemeStore.getState().settingsValues[id]).toBe(before);
    consoleError.mockRestore();
  });
});

describe("apply() dev settings override", () => {
  const id = "local.devPreview";

  beforeEach(() => {
    useThemeStore.setState({
      activeId: id,
      themeFiles: {
        [id]: {
          id,
          name: id,
          tokens: {
            schemaVersion: 2,
            colors: {
              dark: { accent: "hsl({{hue}}, 50%, 50%)" },
              light: { accent: "hsl({{hue}}, 50%, 50%)" },
            },
            roles: { radius: { row: "{{hue}}px" } },
          },
        } as ThemeFile,
      },
      settingsValues: { [id]: { hue: 100 } },
    });
  });

  afterEach(() => {
    useDevStore.getState().clear();
  });

  it.each<[string, Record<string, number> | null, number]>([
    ["the dev override", { hue: 250 }, 250],
    ["the stored values", null, 100],
  ])("apply() substitutes %s into the templated palette", (_case, override, hue) => {
    useDevStore.getState().setSettingsOverride(override);
    useThemeStore.getState().apply();
    expect(writtenProps["--accent"]).toBe(`hsl(${hue}, 50%, 50%)`);
    expect(writtenProps["--t-radius-row"]).toBe(`${hue}px`);
    expect(writtenProps["--setting-hue"]).toBe(String(hue));
  });
});

describe("pickTheme bloom reset", () => {
  it("adopts the picked theme's own glowIntensity as the live bloom", async () => {
    backend.tokensById["local.dim"] = { shadows: { glowIntensity: 0.4 } };
    backend.installed = [{ id: "local.dim", name: "Dim" }];
    useThemeStore.setState({ bloom: 0.9 });

    await useThemeStore.getState().pickTheme("local.dim");

    expect(useThemeStore.getState().bloom).toBe(0.4);
    expect(writtenProps["--bloom"]).toBe("0.4");
  });

  it.each<[string, string]>([
    ["a theme that declares none", "local.plain"],
    ["a preset", "neutral"],
  ])("falls back to the default bloom for %s", async (_case, id) => {
    backend.tokensById["local.plain"] = {};
    backend.installed = [{ id: "local.plain", name: "Plain" }];
    useThemeStore.setState({ bloom: 0.1 });

    await useThemeStore.getState().pickTheme(id);

    expect(useThemeStore.getState().bloom).toBe(DEFAULT_EXTRAS.shadows.glowIntensity);
  });

  it("restores the reverted theme's own glowIntensity, discarding the preview's", async () => {
    backend.tokensById["local.dim"] = { shadows: { glowIntensity: 0.4 } };
    backend.installed = [{ id: "local.dim", name: "Dim" }];
    await useThemeStore.getState().hydrate();
    await useThemeStore.getState().pickTheme("local.dim");
    expect(useThemeStore.getState().bloom).toBe(0.4);

    watchThemeActivationReverted();
    events.reverted?.({ payload: { previousId: "neutral" } });

    expect(useThemeStore.getState().activeId).toBe("neutral");
    expect(useThemeStore.getState().bloom).toBe(DEFAULT_EXTRAS.shadows.glowIntensity);
    expect(writtenProps["--bloom"]).toBe(String(DEFAULT_EXTRAS.shadows.glowIntensity));
  });

  it("drops the customiser overrides when a preview reverts", async () => {
    backend.tokensById["local.dim"] = { shadows: { glowIntensity: 0.4 } };
    backend.installed = [{ id: "local.dim", name: "Dim" }];
    await useThemeStore.getState().hydrate();
    await useThemeStore.getState().pickTheme("local.dim");
    useThemeStore.getState().setColorOverride("accent", "#00ff00");
    useThemeStore.getState().setRadiusRoleOverride("row", "3px");
    useThemeStore.getState().toggleLightRefined();

    watchThemeActivationReverted();
    events.reverted?.({ payload: { previousId: "neutral" } });

    const state = useThemeStore.getState();
    expect(state.activeId).toBe("neutral");
    expect(state.custom).toEqual({ dark: {}, light: {} });
    expect(state.customExtras).toEqual({ radius: {}, family: {} });
    expect(state.lightRefined).toBe(false);
  });

  it("never fetches for an ordinary id-switch revert", async () => {
    useThemeStore.setState({ activeId: "local.dim", themeFiles: {} });

    watchThemeActivationReverted();
    events.reverted?.({ payload: { previousId: "neutral" } });
    await settled();

    expect(backend.themeCalls).toEqual([]);
    expect(useThemeStore.getState().activeId).toBe("neutral");
  });
});

describe("hot reload listener", () => {
  it("re-reads and re-applies the active theme on a matching event", async () => {
    useThemeStore.setState({ activeId: "local.aurora", scheme: "dark" });
    backend.tokensById["local.aurora"] = { dark: { bg: "#123456" } };

    watchHotReload();
    events.hotReload?.({ payload: { id: "local.aurora" } });
    await settled();

    expect(useThemeStore.getState().themeFiles["local.aurora"]?.tokens).toEqual({
      dark: { bg: "#123456" },
    });
    expect(writtenProps["--bg"]).toBe("#123456");
  });

  it("ignores an event for an id that is no longer active", async () => {
    useThemeStore.setState({ activeId: "local.aurora" });
    backend.tokensById["local.stale"] = { dark: { bg: "#123456" } };

    watchHotReload();
    events.hotReload?.({ payload: { id: "local.stale" } });
    await settled();

    expect(backend.themeCalls).toEqual([]);
    expect(useThemeStore.getState().themeFiles["local.stale"]).toBeUndefined();
  });

  it("holds back a reload whose validation reports an error, leaving themeFiles unchanged", async () => {
    useThemeStore.setState({ activeId: "local.aurora", scheme: "dark", themeFiles: {} });
    backend.tokensById["local.aurora"] = { dark: { bg: "#123456" } };
    backend.validationIssuesById["local.aurora"] = [
      { ruleId: "LAY-01", severity: "error", file: "layout/shell.json", pointer: "", message: "bad" },
    ];

    watchHotReload();
    events.hotReload?.({ payload: { id: "local.aurora" } });
    await settled();

    expect(useThemeStore.getState().themeFiles["local.aurora"]).toBeUndefined();
    expect(useDevStore.getState().heldReload).toBe(true);
    expect(useDevStore.getState().issues).toEqual(backend.validationIssuesById["local.aurora"]);
  });

  it("swaps in a reload whose validation reports only warnings, leaving heldReload false", async () => {
    useThemeStore.setState({ activeId: "local.aurora", scheme: "dark", themeFiles: {} });
    backend.tokensById["local.aurora"] = { dark: { bg: "#123456" } };
    backend.validationIssuesById["local.aurora"] = [
      { ruleId: "TOK-05", severity: "warning", file: "tokens.json", pointer: "", message: "low contrast" },
    ];

    watchHotReload();
    events.hotReload?.({ payload: { id: "local.aurora" } });
    await settled();

    expect(useThemeStore.getState().themeFiles["local.aurora"]?.tokens).toEqual({ dark: { bg: "#123456" } });
    expect(useDevStore.getState().heldReload).toBe(false);
    expect(writtenProps["--bg"]).toBe("#123456");
  });

  it("swaps in a reload when validateTheme itself rejects, recording the error", async () => {
    useThemeStore.setState({ activeId: "local.aurora", scheme: "dark", themeFiles: {} });
    backend.tokensById["local.aurora"] = { dark: { bg: "#123456" } };
    backend.validateErrorsById["local.aurora"] = "validator crashed";

    watchHotReload();
    events.hotReload?.({ payload: { id: "local.aurora" } });
    await settled();

    expect(useThemeStore.getState().themeFiles["local.aurora"]?.tokens).toEqual({ dark: { bg: "#123456" } });
    expect(useDevStore.getState().heldReload).toBe(false);
    expect(useDevStore.getState().error).toContain("validator crashed");
    expect(writtenProps["--bg"]).toBe("#123456");
  });

  it("leaves themeFiles unchanged and holds the reload when getTheme itself rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    useThemeStore.setState({ activeId: "local.broken", scheme: "dark", themeFiles: {} });
    backend.getThemeErrorsById["local.broken"] = "corrupt tokens.json";

    watchHotReload();
    events.hotReload?.({ payload: { id: "local.broken" } });
    await settled();

    expect(useThemeStore.getState().themeFiles["local.broken"]).toBeUndefined();
    expect(useDevStore.getState().heldReload).toBe(true);
    expect(useDevStore.getState().error).toContain("corrupt tokens.json");
    consoleError.mockRestore();
  });

  it("matches the id live, not the one active when the listener was registered", async () => {
    useThemeStore.setState({ activeId: "local.first", scheme: "dark" });
    watchHotReload();
    backend.tokensById["local.second"] = { dark: { bg: "#654321" } };
    useThemeStore.setState({ activeId: "local.second" });

    events.hotReload?.({ payload: { id: "local.second" } });
    await settled();

    expect(backend.themeCalls).toEqual(["local.second"]);
    expect(writtenProps["--bg"]).toBe("#654321");
  });
});

describe("getThemeOwnedLayout", () => {
  it("returns the active theme's own file", () => {
    const modal: LayoutFile = { schemaVersion: 1, root: { type: "stack", children: [] } };
    useThemeStore.setState({
      activeId: "local.aurora",
      themeFiles: {
        "local.aurora": {
          layouts: { "layout/modals/serverInfo.json": modal },
        } as unknown as ThemeFile,
      },
    });

    expect(getThemeOwnedLayout("layout/modals/serverInfo.json")).toBe(modal);
  });

  it("returns undefined when the active theme doesn't ship the file", () => {
    useThemeStore.setState({
      activeId: "local.aurora",
      themeFiles: { "local.aurora": { layouts: {} } as unknown as ThemeFile },
    });

    expect(getThemeOwnedLayout("layout/modals/serverInfo.json")).toBeUndefined();
  });
});

describe("per-file fallbacks", () => {
  const FILE: LayoutFile = { schemaVersion: 2, root: { type: "stack", children: [] } };
  const brokenBrowser: ValidationIssue = {
    ruleId: "LAY-01",
    severity: "error",
    file: "layout/views/browser.json",
    pointer: "",
    message: "no valid variant for 650x413",
  };

  async function pickAurora(): Promise<void> {
    backend.installed = [{ id: "local.aurora", name: "Aurora" }];
    backend.tokensById["local.aurora"] = {};
    await useThemeStore.getState().pickTheme("local.aurora");
  }

  it("marks every file the backend dropped, with its rule and message", async () => {
    backend.fallbacksById["local.aurora"] = [brokenBrowser];

    await pickAurora();

    expect(isFileFallenBack("layout/views/browser.json")).toBe(true);
    expect(useFallbackStore.getState().fallbackReasons["layout/views/browser.json"]).toEqual([
      "LAY-01: no valid variant for 650x413",
    ]);
  });

  it("clears the previous theme's fallbacks when the active theme changes", async () => {
    backend.fallbacksById["local.aurora"] = [brokenBrowser];
    await pickAurora();
    expect(isFileFallenBack("layout/views/browser.json")).toBe(true);

    backend.installed = [{ id: "local.clean", name: "Clean" }];
    backend.tokensById["local.clean"] = {};
    await useThemeStore.getState().pickTheme("local.clean");

    expect(isFileFallenBack("layout/views/browser.json")).toBe(false);
  });

  it("getActiveLayout returns Neutral's file for a dropped file, the theme's own otherwise", async () => {
    backend.layoutsById["local.aurora"] = {
      "layout/views/browser.json": FILE,
      "layout/views/mods.json": FILE,
    };
    backend.fallbacksById["local.aurora"] = [brokenBrowser];

    await pickAurora();

    expect(getActiveLayout("layout/views/browser.json")).toBe(
      getNeutralLayout("layout/views/browser.json"),
    );
    expect(getActiveLayout("layout/views/mods.json")).toBe(FILE);
  });

  it("getThemeOwnedLayout returns undefined for a dropped file", async () => {
    backend.layoutsById["local.aurora"] = { "layout/views/mods.json": FILE };
    backend.fallbacksById["local.aurora"] = [brokenBrowser];

    await pickAurora();

    expect(getThemeOwnedLayout("layout/views/browser.json")).toBeUndefined();
    expect(getThemeOwnedLayout("layout/views/mods.json")).toBe(FILE);
  });

  it("Neutral owns no shell, browser or Mods file", () => {
    useThemeStore.setState({ activeId: "neutral", themeFiles: {} });

    expect(getThemeOwnedLayout("layout/shell.json")).toBeUndefined();
    expect(getThemeOwnedLayout("layout/views/browser.json")).toBeUndefined();
    expect(getThemeOwnedLayout("layout/views/mods.json")).toBeUndefined();
    // Neutral's own files stay reachable as the fallback target.
    expect(getActiveLayout("layout/shell.json")).toBe(getNeutralLayout("layout/shell.json"));
  });
});

describe("hot reload holding the last valid file", () => {
  const VALID: LayoutFile = { schemaVersion: 2, root: { type: "stack", children: [] } };
  const brokenShell: ValidationIssue = {
    ruleId: "LAY-01",
    severity: "error",
    file: "layout/shell.json",
    pointer: "/root",
    message: "bad root",
  };

  async function reload(): Promise<void> {
    watchHotReload();
    events.hotReload?.({ payload: { id: "local.aurora" } });
    await settled();
  }

  it("keeps the previous file and leaves it unmarked when the reload drops it", async () => {
    useThemeStore.setState({
      activeId: "local.aurora",
      themeFiles: {
        "local.aurora": { layouts: { "layout/shell.json": VALID } } as unknown as ThemeFile,
      },
    });
    backend.fallbacksById["local.aurora"] = [brokenShell];

    await reload();

    expect(useThemeStore.getState().themeFiles["local.aurora"]?.layouts?.["layout/shell.json"]).toBe(VALID);
    expect(isFileFallenBack("layout/shell.json")).toBe(false);
    expect(getThemeOwnedLayout("layout/shell.json")).toBe(VALID);
  });

  it("marks a dropped file that was never valid in this session", async () => {
    useThemeStore.setState({ activeId: "local.aurora", themeFiles: {} });
    backend.fallbacksById["local.aurora"] = [brokenShell];

    await reload();

    expect(isFileFallenBack("layout/shell.json")).toBe(true);
    expect(getActiveLayout("layout/shell.json")).toBe(getNeutralLayout("layout/shell.json"));
  });

  it("clears the fallback when a later reload brings the file back", async () => {
    useThemeStore.setState({ activeId: "local.aurora", themeFiles: {} });
    backend.fallbacksById["local.aurora"] = [brokenShell];
    await reload();
    expect(isFileFallenBack("layout/shell.json")).toBe(true);

    backend.layoutsById["local.aurora"] = { "layout/shell.json": VALID };
    backend.fallbacksById["local.aurora"] = [];
    await reload();

    expect(isFileFallenBack("layout/shell.json")).toBe(false);
    expect(getThemeOwnedLayout("layout/shell.json")).toBe(VALID);
  });
});
