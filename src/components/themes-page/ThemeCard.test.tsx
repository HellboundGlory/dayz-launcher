import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeCard } from "./ThemeCard";

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
  it("renders the Incompatible marker and its reason", () => {
    const html = renderCard({
      incompatible: true,
      incompatibleReason: "Built for theme API 1.0, which v2 no longer runs.",
      onActivate: undefined,
      onDuplicate: undefined,
      onRequestDelete: () => {},
    });

    expect(html).toContain("Incompatible");
    expect(html).toContain("Built for theme API 1.0, which v2 no longer runs.");
    expect(html).not.toContain(">Activate<");
  });

  it("falls back to a default sentence when the backend sent no reason", () => {
    const html = renderCard({ incompatible: true, onActivate: undefined, onDuplicate: undefined });

    expect(html).toContain("Incompatible");
    expect(html).toContain("This theme uses a format v2 no longer supports.");
  });

  it("does not render the marker or reason text for a compatible card", () => {
    const html = renderCard();

    expect(html).not.toContain("Incompatible");
    expect(html).toContain("by Someone");
  });
});
