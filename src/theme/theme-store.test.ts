/** The one-time localStorage -> file-backed migration, focused on the
 * `custom:<name>` -> installed-id remap a pre-migration selection depends on. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTRAS } from "./apply";
import { DEFAULT_RADII, DEFAULT_SPACING, DEFAULT_TYPOGRAPHY, type Palette } from "./palette";
import {
  effectiveExtras,
  mergeSettingsValues,
  resolvedExtras,
  useThemeStore,
  watchHotReload,
  watchThemeActivationReverted,
} from "./theme-store";
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
  /** `tokens.json` contents `get_theme` returns, by id. */
  tokensById: {} as Record<string, unknown>,
  /** `settings.values.json` contents `get_theme_settings_values` returns, by id. */
  settingsById: {} as Record<string, Record<string, unknown>>,
  /** Each theme's `settings.schema.json`, by id. */
  schemaById: {} as Record<string, unknown>,
  /** `layout.json` contents `get_theme` returns, by id. */
  layoutById: {} as Record<string, unknown>,
  /** Every `set_theme_settings_value` call, in order. */
  setSettingsCalls: [] as { id: string; fieldId: string; value: number | boolean }[],
  /** Ids `get_theme` was asked for, in call order. */
  themeCalls: [] as string[],
}));

const events = vi.hoisted(() => ({
  /** The handler `watchThemeActivationReverted` registered, if any. */
  reverted: null as
    | ((event: { payload: { previousId: string | null; restoredTheme: string | null } }) => void)
    | null,
  /** The handler `watchHotReload` registered, if any. */
  hotReload: null as ((event: { payload: { id: string } }) => void) | null,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (
    name: string,
    handler: (event: {
      payload: { previousId: string | null; restoredTheme: string | null };
    }) => void,
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
    return {
      id,
      name: id,
      tokens: backend.tokensById[id] ?? {},
      layout: backend.layoutById[id] ?? null,
      settingsSchema: backend.schemaById[id] ?? null,
    };
  },
  getSettings: async () => ({ activeThemeId: null }),
  setActiveThemeId: async (id: string | null) => void backend.setActiveCalls.push(id),
  migrateLegacyCustomThemes: async () => backend.migratedIds,
  armActivation: async () => {},
  saveTheme: async (_manifest: unknown, tokens: unknown) => void backend.savedTokens.push(tokens),
  deleteTheme: async () => {},
  getThemeSettingsValues: async (id: string) => backend.settingsById[id] ?? {},
  setThemeSettingsValue: async (id: string, fieldId: string, value: number | boolean) => {
    backend.setSettingsCalls.push({ id, fieldId, value });
  },
}));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
});

// applyTheme writes straight onto the document element's style; applyThemeStylesheet
// and applyThemeFonts touch head/fonts, so the stub covers those too.
interface StubLink {
  attributes: Record<string, string>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
}
/** Every `--token` applyTheme wrote, most recent write per token. */
const writtenProps: Record<string, string> = {};
const themeCssHead: StubLink[] = [];
const addedFonts: unknown[] = [];
const fontFaces: { family: string; source: string }[] = [];
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
  fonts: {
    add: (face: unknown) => void addedFonts.push(face),
    delete: () => {},
  },
});
vi.stubGlobal(
  "FontFace",
  class {
    constructor(
      public family: string,
      public source: string,
    ) {
      fontFaces.push(this);
    }
    load() {
      return Promise.resolve(this);
    }
  },
);

const PALETTE = { bg: "#101010" } as Palette;

beforeEach(() => {
  storage.clear();
  backend.migratedIds.length = 0;
  backend.setActiveCalls.length = 0;
  backend.installed = [];
  backend.savedTokens.length = 0;
  backend.tokensById = {};
  backend.settingsById = {};
  backend.schemaById = {};
  backend.layoutById = {};
  backend.setSettingsCalls.length = 0;
  backend.themeCalls.length = 0;
  themeCssHead.length = 0;
  fontFaces.length = 0;
  addedFonts.length = 0;
  for (const name of Object.keys(writtenProps)) delete writtenProps[name];
  useThemeStore.setState({ activeId: "neutral", themeFiles: {}, settingsValues: {} });
});

/** Two microtask turns: enough for an `applyThemeFonts` load chain to settle. */
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
    expect(resolvedExtras("ember", files({}))).toEqual(DEFAULT_EXTRAS);
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

  it("persists the merged extras into a saved theme's tokens", async () => {
    useThemeStore.setState({
      activeId: "local.partial",
      themeFiles: files({ spacing: { md: "12px" } }),
      customExtras: { spacing: {}, radii: { chip: "1px" }, typography: {} },
      bloom: 0.42,
    });

    await useThemeStore.getState().saveTheme("Extras skin");

    expect(backend.savedTokens).toHaveLength(1);
    const tokens = backend.savedTokens[0] as Record<string, unknown>;
    expect(tokens.spacing).toEqual({ ...DEFAULT_SPACING, md: "12px" });
    expect(tokens.radii).toEqual({ ...DEFAULT_RADII, chip: "1px" });
    expect(tokens.typography).toEqual(DEFAULT_TYPOGRAPHY);
    // effectiveExtras never merges bloom in — saving the live theme must
    // still capture whatever the slider currently shows, same as every
    // other extras field, not silently keep the source theme's own value.
    expect(tokens.shadows).toEqual({ glowIntensity: 0.42 });
  });
});

describe("apply() asset wiring", () => {
  const installed = (id: string, capabilities: string[]) => {
    backend.installed = [{ id, name: id }];
    return {
      id,
      name: id,
      capabilities,
      tokens: { typography: { customFonts: [{ family: "Aurora Sans", file: "fonts/a.woff2" }] } },
    } as ThemeFile;
  };

  it("applies the active theme's stylesheet and fonts, then unloads them on a theme without them", async () => {
    const loaded = installed("local.aurora", ["tokens", "css", "fonts"]);
    useThemeStore.setState({ activeId: "local.aurora", themeFiles: { "local.aurora": loaded } });

    useThemeStore.getState().apply();
    await settled();
    expect(themeCssHead.map((el) => el.attributes.href)).toEqual([
      "tetra-theme://local.aurora/styles.css",
    ]);
    expect(fontFaces.map((f) => f.source)).toEqual([
      "url(tetra-theme://local.aurora/fonts/a.woff2)",
    ]);

    useThemeStore.getState().setScheme("light");
    expect(themeCssHead).toHaveLength(1);

    // Neutral has no ThemeFile at all: nothing may stay applied.
    useThemeStore.setState({ activeId: "neutral", themeFiles: {} });
    useThemeStore.getState().apply();
    await settled();
    expect(themeCssHead).toHaveLength(0);
    expect(addedFonts).toHaveLength(1);
  });

  it("drops customFonts entries missing a string family or file", async () => {
    const theme = {
      id: "local.partial",
      name: "Partial",
      capabilities: ["fonts"],
      tokens: {
        typography: {
          customFonts: [
            { family: "Good", file: "fonts/good.woff2" },
            { family: "NoFile" },
            { file: "fonts/no-family.woff2" },
            "nonsense",
          ],
        },
      },
    } as ThemeFile;
    useThemeStore.setState({ activeId: "local.partial", themeFiles: { "local.partial": theme } });

    useThemeStore.getState().apply();
    await settled();

    expect(fontFaces).toEqual([
      { family: "Good", source: "url(tetra-theme://local.partial/fonts/good.woff2)" },
    ]);
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
    ];

    expect(mergeSettingsValues(fields, { accentHue: 300 })).toEqual({
      accentHue: 300,
      compactRows: false,
    });
  });

  it("treats a wrong-typed value and an unknown field id as untuned", () => {
    const fields = [
      { id: "accentHue", type: "number" as const, label: "Accent hue", min: 0, max: 360, default: 210 },
      { id: "compactRows", type: "boolean" as const, label: "Compact rows", default: false },
    ];

    expect(
      mergeSettingsValues(fields, { accentHue: "300", compactRows: true, gone: 1 }),
    ).toEqual({ accentHue: 210, compactRows: true });
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

    await useThemeStore.getState().pickTheme("ember");

    expect(useThemeStore.getState().bloom).toBe(DEFAULT_EXTRAS.shadows.glowIntensity);
  });

  it("restores the reverted theme's own glowIntensity, discarding the preview's", async () => {
    backend.tokensById["local.dim"] = { shadows: { glowIntensity: 0.4 } };
    backend.installed = [{ id: "local.dim", name: "Dim" }];
    await useThemeStore.getState().hydrate();
    await useThemeStore.getState().pickTheme("local.dim");
    expect(useThemeStore.getState().bloom).toBe(0.4);

    watchThemeActivationReverted();
    events.reverted?.({ payload: { previousId: "neutral", restoredTheme: null } });

    expect(useThemeStore.getState().activeId).toBe("neutral");
    expect(useThemeStore.getState().bloom).toBe(DEFAULT_EXTRAS.shadows.glowIntensity);
    expect(writtenProps["--bloom"]).toBe(String(DEFAULT_EXTRAS.shadows.glowIntensity));
  });

  it("re-reads the restored theme's file and repaints from it before resetting the ids", async () => {
    const id = "local.edited";
    useThemeStore.setState({
      activeId: id,
      themeFiles: {
        [id]: {
          id,
          name: id,
          tokens: { dark: { bg: "#000000" } },
          // The abandoned preview's layout; the file on disk no longer has it.
          layout: { schemaVersion: 1, slots: { "shell.footer": { order: ["serverCounts"] } } },
        } as ThemeFile,
      },
    });
    // What revert put back on disk.
    backend.layoutById[id] = { schemaVersion: 1, slots: {} };

    watchThemeActivationReverted();
    events.reverted?.({ payload: { previousId: id, restoredTheme: id } });
    await settled();

    expect(backend.themeCalls).toEqual([id]);
    expect(useThemeStore.getState().themeFiles[id]?.layout).toEqual({ schemaVersion: 1, slots: {} });
    expect(useThemeStore.getState().activeId).toBe(id);
  });

  it("never fetches for an ordinary id-switch revert", async () => {
    useThemeStore.setState({ activeId: "local.dim", themeFiles: {} });

    watchThemeActivationReverted();
    events.reverted?.({ payload: { previousId: "neutral", restoredTheme: null } });
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
