import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DevModeSwitcher, DevModeSwitcherView, type DevModeSwitcherViewProps } from "./DevModeSwitcher";
import type { ThemeFile } from "@/types/theme";
import type { LayoutFile } from "@/theme/renderer/types";

const themeState = {
  activeId: "local.variants",
  themeFiles: {} as Record<string, ThemeFile>,
};
const devState = {
  variantWidth: null as number | null,
  settingsOverride: null as Record<string, string | number | boolean> | null,
  activeRenderers: 1,
  setVariantWidth: () => {},
  setSettingsOverride: () => {},
};

vi.mock("@/theme/theme-store", () => ({
  useThemeStore: Object.assign(
    (selector: (s: typeof themeState) => unknown) => selector(themeState),
    { getState: () => themeState },
  ),
}));
vi.mock("@/theme/dev/dev-store", () => ({
  useDevStore: Object.assign(
    (selector: (s: typeof devState) => unknown) => selector(devState),
    { getState: () => devState },
  ),
}));

const BASE_PROPS: DevModeSwitcherViewProps = {
  widths: [650, 975, 1400],
  activeWidth: null,
  combinations: [{ label: "compact=off · density=cosy" }, { label: "compact=on · density=cosy" }],
  activeCombination: null,
  capped: false,
  settingsAvailable: true,
  variantInertReason: null,
  onPickWidth: () => {},
  onPickCombination: () => {},
};

function render(overrides: Partial<DevModeSwitcherViewProps> = {}) {
  return renderToStaticMarkup(<DevModeSwitcherView {...BASE_PROPS} {...overrides} />);
}

describe("DevModeSwitcherView", () => {
  it("renders a 'Real width' button plus one per supplied width", () => {
    const html = render();
    expect(html).toContain("Real width");
    expect(html).toContain("650px");
    expect(html).toContain("975px");
    expect(html).toContain("1400px");
  });

  it("marks the active width button with aria-pressed=true and the rest false", () => {
    const html = render({ activeWidth: 975 });
    const buttonFor = (label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? "";
    expect(buttonFor("Real width")).toContain('aria-pressed="false"');
    expect(buttonFor("650px")).toContain('aria-pressed="false"');
    expect(buttonFor("975px")).toContain('aria-pressed="true"');
    expect(buttonFor("1400px")).toContain('aria-pressed="false"');
  });

  it("renders combination labels with 'Theme's own values' first", () => {
    const html = render();
    const ownValuesIndex = html.indexOf("Theme&#x27;s own values");
    const firstComboIndex = html.indexOf("compact=off");
    expect(ownValuesIndex).toBeGreaterThan(-1);
    expect(firstComboIndex).toBeGreaterThan(-1);
    expect(ownValuesIndex).toBeLessThan(firstComboIndex);
  });

  it("renders 'No theme settings' and no combination buttons when settings are unavailable", () => {
    const html = render({ settingsAvailable: false, combinations: [] });
    expect(html).toContain("No theme settings");
    expect(html).not.toContain("compact=");
    expect(html).not.toContain("Theme&#x27;s own values");
  });

  it("renders the capped notice when capped is true", () => {
    expect(render({ capped: true })).toContain("Showing the first 64 combinations");
    expect(render({ capped: false })).not.toContain("Showing the first 64 combinations");
  });

  it("renders the inert reason and no width chips or Real width button when non-null", () => {
    const html = render({ variantInertReason: "No screen renders from a layout file yet" });
    expect(html).toContain("No screen renders from a layout file yet");
    expect(html).not.toContain("Real width");
    expect(html).not.toContain("650px");
    expect(html).not.toContain("975px");
    expect(html).not.toContain("1400px");
  });

  it("renders the width chips as today when variantInertReason is null", () => {
    const html = render({ variantInertReason: null });
    expect(html).toContain("Real width");
    expect(html).toContain("650px");
  });
});

describe("DevModeSwitcher variant widths", () => {
  const layout = (minWidth: number): LayoutFile => ({
    schemaVersion: 2,
    variants: [{ minWidth, root: { type: "stack", children: [] } }],
  });

  const theme = (layouts?: Record<string, LayoutFile>): ThemeFile => ({
    schemaVersion: 2,
    id: "local.variants",
    name: "Variants",
    author: "Someone",
    version: "1.0.0",
    themeApi: "2.0",
    minimumLauncherVersion: "2.6.0",
    description: "",
    preview: null,
    license: null,
    homepage: null,
    tags: [],
    capabilities: ["tokens", "layout"],
    tokens: {},
    settingsSchema: null,
    layouts,
  });

  it("adds a chip for every variant minWidth across the theme's layout files", () => {
    themeState.themeFiles = {
      "local.variants": theme({
        "layout/shell.json": layout(1180),
        "layout/views/browser.json": layout(900),
      }),
    };

    const html = renderToStaticMarkup(<DevModeSwitcher />);

    expect(html).toContain("1180px");
    expect(html).toContain("900px");
  });

  it("reports no variants for a theme that ships no layout files", () => {
    themeState.themeFiles = { "local.variants": theme() };

    const html = renderToStaticMarkup(<DevModeSwitcher />);

    expect(html).toContain("No variants declared");
  });
});
