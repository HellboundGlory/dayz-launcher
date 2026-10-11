import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clampPanelPosition,
  DevModeValidationPanelView,
  type DevModeValidationPanelViewProps,
} from "./DevModeValidationPanel";
import type { ValidationIssue } from "@/types/theme";

const BASE_PROPS: DevModeValidationPanelViewProps = {
  themeId: "my-theme",
  issues: [],
  contrast: [],
  fallbackReasons: {},
  error: null,
  refreshing: false,
  collapsed: false,
  onToggleCollapse: () => {},
  onRefresh: () => {},
  copyState: null,
  onCopy: () => {},
  heldReload: false,
};

const ERROR_ISSUE: ValidationIssue = {
  ruleId: "LAY-01",
  severity: "error",
  file: "layout/shell.json",
  pointer: "/slots/main",
  message: "missing required child",
};

const WARNING_ISSUE: ValidationIssue = {
  ruleId: "LAY-02",
  severity: "warning",
  file: "layout/shell.json",
  pointer: "/slots/side",
  message: "unusual nesting",
};

const CONTRAST_ISSUE: ValidationIssue = {
  ruleId: "TOK-05",
  severity: "warning",
  file: "tokens.json",
  pointer: "/colors/dark/muted",
  message: "muted on surface is 4.0:1 (needs 4.5:1)",
};

function render(overrides: Partial<DevModeValidationPanelViewProps> = {}) {
  return renderToStaticMarkup(<DevModeValidationPanelView {...BASE_PROPS} {...overrides} />);
}

describe("DevModeValidationPanelView", () => {
  it("renders issues grouped by file with rule id, pointer and message, and a distinct severity chip", () => {
    const html = render({ issues: [ERROR_ISSUE, WARNING_ISSUE] });
    expect(html).toContain("layout/shell.json");
    expect(html).toContain("LAY-01");
    expect(html).toContain("/slots/main");
    expect(html).toContain("missing required child");
    expect(html).toContain("LAY-02");
    expect(html).toContain("/slots/side");
    expect(html).toContain(">error<");
    expect(html).toContain(">warning<");
  });

  it("renders a fallback reason under its file", () => {
    const html = render({ fallbackReasons: { "layout/shell.json": ["no valid variant for 650x413"] } });
    expect(html).toContain("Fell back to Neutral");
    expect(html).toContain("layout/shell.json");
    expect(html).toContain("no valid variant for 650x413");
  });

  it("renders contrast issues in their own section", () => {
    const html = render({ contrast: [CONTRAST_ISSUE] });
    expect(html).toContain("Contrast");
    expect(html).toContain("TOK-05");
    expect(html).toContain("muted on surface is 4.0:1 (needs 4.5:1)");
  });

  it("shows the empty state when issues, contrast and fallback reasons are all empty", () => {
    const html = render();
    expect(html).toContain("No issues");
  });

  it("renders the store error as a 'Could not validate' line", () => {
    const html = render({ error: "theme folder missing" });
    expect(html).toContain("Could not validate: theme folder missing");
  });

  it("hides the body, issues and injected switcher alike, when collapsed", () => {
    const switcher = <div data-testid="the-switcher">switcher markup</div>;

    const collapsedHtml = render({ collapsed: true, issues: [ERROR_ISSUE], switcher });
    expect(collapsedHtml).not.toContain("missing required child");
    expect(collapsedHtml).not.toContain("switcher markup");

    const expandedHtml = render({ collapsed: false, issues: [ERROR_ISSUE], switcher });
    expect(expandedHtml).toContain("missing required child");
    expect(expandedHtml).toContain("switcher markup");
  });

  it("renders the held-reload line only when heldReload is true", () => {
    expect(render({ heldReload: true })).toContain("Hot reload held");
    expect(render({ heldReload: false })).not.toContain("Hot reload held");
  });

  it("uses the positioning style it is handed, or the default top-right anchor", () => {
    const dragged = render({ positionStyle: { top: 100, left: 50 } });
    expect(dragged).toContain("top:100px");
    expect(dragged).toContain("left:50px");

    const anchored = render();
    expect(anchored).toContain("top:36px");
    expect(anchored).toContain("right:8px");
  });

  it("gives the header a grab cursor, and a grabbing cursor while dragging", () => {
    expect(render()).toContain("cursor:grab");
    expect(render({ dragging: true })).toContain("cursor:grabbing");
  });
});

describe("clampPanelPosition", () => {
  const size = { w: 400, h: 300 };
  const viewport = { w: 1200, h: 800 };

  it.each([
    { case: "already inside", pos: { top: 100, left: 200 }, canvas: size, want: { top: 100, left: 200 } },
    { case: "past the right and bottom edges", pos: { top: 790, left: 1190 }, canvas: size, want: { top: 492, left: 792 } },
    { case: "at negative coordinates", pos: { top: -50, left: -20 }, canvas: size, want: { top: 8, left: 8 } },
    { case: "larger than the viewport", pos: { top: 100, left: 100 }, canvas: { w: 1500, h: 900 }, want: { top: 8, left: 8 } },
  ])("clamps a panel $case into the 8px margin", ({ pos, canvas, want }) => {
    expect(clampPanelPosition(pos, canvas, viewport)).toEqual(want);
  });
});
