/** The customiser's v2 surface: the six roles it edits (SPEC §4.6), and that
 * an edit goes straight to the store action for that role. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ThemeStoreModule from "@/theme/theme-store";
import { DATA_FONT_STACK, UI_FONT_STACK } from "@/theme/palette";
import { ThemeCustomiser } from "./theme-customiser";
import { useThemeStore } from "@/theme/theme-store";

// SSR takes zustand's initial-state snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/theme/theme-store", async (importOriginal) => {
  const actual = await importOriginal<typeof ThemeStoreModule>();
  return { ...actual, useThemeStore: liveHook(actual.useThemeStore) };
});

// Captures props by id since renderToStaticMarkup drops event handlers.
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const id = props?.id;
      if (typeof id === "string") captured[id] = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

// apply() reaches for the document root and the UI prefs; nothing here asserts
// either, but both have to exist.
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("document", {
  documentElement: { style: { setProperty: () => {} } },
  getElementById: () => null,
});

const ROW_IDS = [
  "extras-Radii-window",
  "extras-Radii-panel",
  "extras-Radii-row",
  "extras-Radii-control",
  "extras-Fonts-ui",
  "extras-Fonts-data",
];

function edit(id: string, value: string): void {
  const onChange = captured[id].onChange as (e: { target: { value: string } }) => void;
  onChange({ target: { value } });
}

beforeEach(() => {
  useThemeStore.setState({
    activeId: "neutral",
    themeFiles: {},
    custom: { dark: {}, light: {} },
    customExtras: { radius: {}, family: {} },
  });
});

afterEach(() => {
  for (const key of Object.keys(captured)) delete captured[key];
});

describe("ThemeCustomiser", () => {
  it("edits the four radius roles and the two families, and nothing else", () => {
    const html = renderToStaticMarkup(<ThemeCustomiser />);

    for (const id of ROW_IDS) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain("extras-Spacing");
    expect(html).not.toContain("Chip");
    expect(html).not.toContain("Pill");
  });

  it("shows Neutral's resolved roles", () => {
    renderToStaticMarkup(<ThemeCustomiser />);

    expect(captured["extras-Radii-window"].value).toBe("8px");
    expect(captured["extras-Radii-panel"].value).toBe("9px");
    expect(captured["extras-Radii-row"].value).toBe("8px");
    expect(captured["extras-Radii-control"].value).toBe("6px");
    expect(captured["extras-Fonts-ui"].value).toBe(UI_FONT_STACK);
    expect(captured["extras-Fonts-data"].value).toBe(DATA_FONT_STACK);
  });

  it("writes each edit to that role's own store action", () => {
    renderToStaticMarkup(<ThemeCustomiser />);

    edit("extras-Radii-row", "12px");
    edit("extras-Fonts-ui", "Comic Sans");

    expect(useThemeStore.getState().customExtras).toEqual({
      radius: { row: "12px" },
      family: { ui: "Comic Sans" },
    });

    useThemeStore.getState().resetToBase();
    expect(useThemeStore.getState().customExtras).toEqual({ radius: {}, family: {} });
  });
});
