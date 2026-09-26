/** The one-time localStorage -> file-backed migration, focused on the
 * `custom:<name>` -> installed-id remap a pre-migration selection depends on. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTRAS } from "./apply";
import { useDevStore } from "./dev/dev-store";
import {
  DEFAULT_RADII,
  DEFAULT_SPACING,
  DEFAULT_TYPOGRAPHY,
  NEUTRAL_DARK,
  NEUTRAL_LIGHT,
  type Palette,
} from "./palette";
import {
  effectiveExtras,
  getThemeOwnedLayout,
  mergeSettingsValues,
  resolvedExtras,
  useThemeStore,
  watchHotReload,
  watchThemeActivationReverted,
} from "./theme-store";
import type { ThemeFile, ValidationIssue } from "@/types/theme";
import { NEUTRAL_TOKENS, parseTokens } from "./tokens";
import type { LayoutFile } from "./renderer/types";

const backend = vi.hoisted(() => ({
  /** What `migrate_legacy_custom_themes` reports back, in input order. */
  migratedIds: [] as string[],
  /** Ids written through `set_active_theme_id`, in call order. */
  setActiveCalls: [] as (string | null)[],
  /** What `list_installed_themes` sees. */
  installed: [] as { id: string; name: string; incompatible?: boolean }[],
  /** The `tokens` object each `save_theme` call received, in call order. */
  savedTokens: [] as unknown[],
  /** The manifest each `save_theme` call received, in call order. */
  savedManifests: [] as unknown[],
  /** `tokens.json` contents `get_theme` returns, by id. */
  tokensById: {} as Record<string, unknown>,
  /** `settings.values.json` contents `get_theme_settings_values` returns, by id. */
  settingsById: {} as Record<string, Record<string, unknown>>,
  /** Each theme's `settings.schema.json`, by id. */
  schemaById: {} as Record<string, unknown>,
  /** Every `set_theme_settings_value` call, in order. */
  setSettingsCalls: [] as { id: string; fieldId: string; value: string | number | boolean }[],
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
      settingsSchema: backend.schemaById[id] ?? null,
    };
  },
  getSettings: async () => ({ activeThemeId: null }),
  setActiveThemeId: async (id: string | null) => void backend.setActiveCalls.push(id),
  migrateLegacyCustomThemes: async () => backend.migratedIds,
  armActivation: async () => {},
  saveTheme: async (manifest: unknown, tokens: unknown) => {
    backend.savedManifests.push(manifest);
    backend.savedTokens.push(tokens);
  },
  deleteTheme: async () => {},
  getThemeSettingsValues: async (id: string) => backend.settingsById[id] ?? {},
  setThemeSettingsValue: async (id: string, fieldId: string, value: string | number | boolean) => {
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
  backend.savedTokens.length = 0;
  backend.savedManifests.length = 0;
  backend.tokensById = {};
  backend.settingsById = {};
  backend.schemaById = {};
  backend.setSettingsCalls.length = 0;
  backend.themeCalls.length = 0;
  backend.validationIssuesById = {};
  backend.validateErrorsById = {};
  backend.validateCalls.length = 0;
  backend.getThemeErrorsById = {};
  themeCssHead.length = 0;
  for (const name of Object.keys(writtenProps)) delete writtenProps[name];
  useThemeStore.setState({ activeId: "neutral", themeFiles: {}, settingsValues: {} });
  useDevStore.getState().clear();
});

/** Two microtask turns: enough for async operations to settle. */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

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

  it("leaves activeId alone when the stored active theme is not incompatible", async () => {
    storage.set("tetra.themeActive", JSON.stringify({ activeId: "local.fine" }));
    backend.installed = [{ id: "local.fine", name: "Fine" }];

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().activeId).toBe("local.fine");
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

  it("fills the missing spacing keys of a partial theme from the defaults", () => {
    const themeFiles = files({ spacing: { md: "12px" } });

    const extras = resolvedExtras("local.partial", themeFiles);

    expect(extras.spacing).toEqual({ ...DEFAULT_SPACING, md: "12px" });
  });

  it("keeps the defaults for a preset and for a theme with no extras", () => {
    expect(resolvedExtras("neutral", files({}))).toEqual(DEFAULT_EXTRAS);
    expect(resolvedExtras("local.partial", files({}))).toEqual(DEFAULT_EXTRAS);
  });

  it("ignores non-string values in an untrusted tokens.json", () => {
    const themeFiles = files({ spacing: { md: 12, lg: "20px" }, typography: null });

    expect(resolvedExtras("local.partial", themeFiles).spacing).toEqual({
      ...DEFAULT_SPACING,
      lg: "20px",
    });
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

  it("passes the merged extras and the live bloom to applyTheme, and clears them on reset", () => {
    useThemeStore.setState({
      activeId: "local.partial",
      themeFiles: files({ spacing: { md: "12px" } }),
      customExtras: { spacing: { lg: "40px" }, radii: {}, typography: {} },
      bloom: 0.35,
    });

    useThemeStore.getState().apply();
    expect(writtenProps["--space-lg"]).toBe("40px");
    expect(writtenProps["--space-md"]).toBe("12px");
    // The slider's live value renders; the theme's own glowIntensity only
    // seeds it at pick time.
    expect(writtenProps["--bloom"]).toBe("0.35");

    useThemeStore.getState().resetToBase();
    expect(writtenProps["--space-lg"]).toBe(DEFAULT_SPACING.lg);
    expect(useThemeStore.getState().customExtras).toEqual({
      spacing: {},
      radii: {},
      typography: {},
    });
  });

  it("persists the live bloom into a saved theme's v2 palette", async () => {
    useThemeStore.setState({
      activeId: "local.partial",
      themeFiles: { "local.partial": { id: "local.partial", tokens: { schemaVersion: 2 } } as ThemeFile },
      bloom: 0.42,
    });

    await useThemeStore.getState().saveTheme("Extras skin");

    expect(backend.savedTokens).toHaveLength(1);
    // The slider's live value, not the source theme's own glowIntensity.
    expect(parseTokens(backend.savedTokens[0]).bloom).toBe(0.42);
  });
});

describe("duplicateTheme", () => {
  const themeFile = (tokens: unknown): ThemeFile =>
    ({
      id: "local.source",
      name: "Source",
      tokens,
      settingsSchema: null,
      layouts: {},
    }) as unknown as ThemeFile;

  it("writes a v2 manifest and a v2 palette, copying the source's scales and roles", async () => {
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

    expect(backend.savedManifests[0]).toMatchObject({
      schemaVersion: 2,
      themeApi: "2.0",
      id: "local.extras-skin",
      author: "local",
      capabilities: ["tokens"],
    });
    expect(backend.savedManifests[0]).not.toHaveProperty("tier");

    // `parseTokens` is the same validation the backend's TokensV2 applies: a
    // shape it rejects would throw here.
    const tokens = parseTokens(backend.savedTokens[0]);
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

    const tokens = parseTokens(backend.savedTokens[0]);
    expect(tokens.schemaVersion).toBe(2);
    expect(tokens.scales).toEqual(NEUTRAL_TOKENS.scales);
    expect(tokens.roles).toEqual(NEUTRAL_TOKENS.roles);
    // The source's own bloom, not the slider's — only the live theme takes the slider.
    expect(tokens.bloom).toBe(0.3);
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
      "tetra-theme://local.aurora/styles.css",
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
  const SCHEMA = {
    schemaVersion: 1,
    fields: [
      { id: "accentHue", type: "number", label: "Accent hue", min: 0, max: 360, default: 210 },
      { id: "compactRows", type: "boolean", label: "Compact rows", default: false },
    ],
  };

  /** A theme whose palette is templated on the two schema fields above. Both
   * schemes are templated so an assertion holds whichever one is active. */
  const templated = (id: string) => {
    backend.installed = [{ id, name: id }];
    backend.schemaById[id] = SCHEMA;
    backend.tokensById[id] = {
      dark: { accent: "hsl({{accentHue}}, 45%, 60%)" },
      light: { accent: "hsl({{accentHue}}, 45%, 60%)" },
      spacing: { md: "{{accentHue}}px" },
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
    expect(writtenProps["--space-md"]).toBe("300px");
  });

  it("renders a never-tuned field as its schema default, not literal or undefined", async () => {
    const id = templated("local.untuned");

    await useThemeStore.getState().pickTheme(id);

    // A complete values object always reaches substitution: the untuned field
    // carries its own default, which is what renders.
    expect(writtenProps["--accent"]).toBe("hsl(210, 45%, 60%)");
    expect(writtenProps["--space-md"]).toBe("210px");
  });

  it("leaves a placeholder no field names literal, per Package C's contract", async () => {
    const id = templated("local.stale");
    backend.tokensById[id] = {
      dark: { accent: "hsl({{goneHue}}, 45%, 60%)" },
      light: { accent: "hsl({{goneHue}}, 45%, 60%)" },
    };

    await useThemeStore.getState().pickTheme(id);

    expect(writtenProps["--accent"]).toBe("hsl({{goneHue}}, 45%, 60%)");
  });

  it("writes a tuned value through and repaints from it without re-reading", async () => {
    const id = templated("local.tuned");
    backend.settingsById[id] = {};
    await useThemeStore.getState().pickTheme(id);

    await useThemeStore.getState().setSettingsValue(id, "accentHue", 42);

    expect(backend.setSettingsCalls).toEqual([{ id, fieldId: "accentHue", value: 42 }]);
    expect(writtenProps["--accent"]).toBe("hsl(42, 45%, 60%)");
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
            dark: { accent: "hsl({{hue}}, 50%, 50%)" },
            light: { accent: "hsl({{hue}}, 50%, 50%)" },
            spacing: { md: "{{hue}}px" },
          },
        } as ThemeFile,
      },
      settingsValues: { [id]: { hue: 100 } },
    });
  });

  afterEach(() => {
    useDevStore.getState().clear();
  });

  it("substitutes the dev override's values instead of the stored ones", () => {
    useDevStore.getState().setSettingsOverride({ hue: 250 });
    useThemeStore.getState().apply();
    expect(writtenProps["--accent"]).toBe("hsl(250, 50%, 50%)");
    expect(writtenProps["--space-md"]).toBe("250px");
    expect(writtenProps["--setting-hue"]).toBe("250");
  });

  it("substitutes the stored values exactly as before when there is no override", () => {
    useThemeStore.getState().apply();
    expect(writtenProps["--accent"]).toBe("hsl(100, 50%, 50%)");
    expect(writtenProps["--space-md"]).toBe("100px");
    expect(writtenProps["--setting-hue"]).toBe("100");
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

  it("falls back to the default bloom when the picked theme declares none", async () => {
    backend.tokensById["local.plain"] = {};
    backend.installed = [{ id: "local.plain", name: "Plain" }];
    useThemeStore.setState({ bloom: 0.1 });

    await useThemeStore.getState().pickTheme("local.plain");

    expect(useThemeStore.getState().bloom).toBe(DEFAULT_EXTRAS.shadows.glowIntensity);
  });

  it("resets bloom to the default for a preset", async () => {
    useThemeStore.setState({ bloom: 0.1 });

    await useThemeStore.getState().pickTheme("neutral");

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

  it("ignores Neutral, unlike getActiveLayout", () => {
    useThemeStore.setState({ activeId: "local.aurora", themeFiles: {} });

    expect(getThemeOwnedLayout("layout/modals/serverInfo.json")).toBeUndefined();
  });

  it("returns undefined when the active theme doesn't ship the file", () => {
    useThemeStore.setState({
      activeId: "local.aurora",
      themeFiles: { "local.aurora": { layouts: {} } as unknown as ThemeFile },
    });

    expect(getThemeOwnedLayout("layout/modals/serverInfo.json")).toBeUndefined();
  });
});
