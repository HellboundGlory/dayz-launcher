import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DevModeValidationPanelView, type DevModeValidationPanelViewProps } from "./DevModeValidationPanel";
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

  it("hides the body when collapsed and shows it again when expanded", () => {
    const collapsedHtml = render({ collapsed: true, issues: [ERROR_ISSUE] });
    expect(collapsedHtml).not.toContain("missing required child");

    const expandedHtml = render({ collapsed: false, issues: [ERROR_ISSUE] });
    expect(expandedHtml).toContain("missing required child");
  });
});
