import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeCard } from "./theme-card";

const SWATCHES: [string, string, string, string] = ["#000", "#111", "#222", "#333"];

const renderCard = (overrides: Partial<Parameters<typeof ThemeCard>[0]> = {}) =>
  renderToStaticMarkup(
    <ThemeCard
      name="Old Skin"
      builtin={false}
      author="Someone"
      version="1.0.0"
      active={false}
      swatches={SWATCHES}
      onActivate={() => {}}
      onDuplicate={() => {}}
      {...overrides}
    />,
  );

describe("ThemeCard incompatible state", () => {
  it.each([
    {
      case: "the backend's reason",
      reason: "Built for theme API 1.0, which v2 no longer runs.",
      want: "Built for theme API 1.0, which v2 no longer runs.",
    },
    { case: "the default sentence when none is sent", reason: undefined, want: "This theme uses a format v2 no longer supports." },
  ])("renders the Incompatible marker with $case", ({ reason, want }) => {
    const html = renderCard({
      incompatible: true,
      incompatibleReason: reason,
      onActivate: undefined,
      onDuplicate: undefined,
      onRequestDelete: () => {},
    });

    expect(html).toContain("Incompatible");
    expect(html).toContain(want);
    expect(html).not.toContain(">Activate<");
  });

  it("does not render the marker or reason text for a compatible card", () => {
    const html = renderCard();

    expect(html).not.toContain("Incompatible");
    expect(html).toContain("by Someone");
  });
});
