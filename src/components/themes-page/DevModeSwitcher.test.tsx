import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DevModeSwitcherView, type DevModeSwitcherViewProps } from "./DevModeSwitcher";

const BASE_PROPS: DevModeSwitcherViewProps = {
  widths: [650, 975, 1400],
  activeWidth: null,
  combinations: [{ label: "compact=off · density=cosy" }, { label: "compact=on · density=cosy" }],
  activeCombination: null,
  capped: false,
  settingsAvailable: true,
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
});
