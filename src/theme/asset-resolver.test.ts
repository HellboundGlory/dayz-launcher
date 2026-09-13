import { describe, expect, it } from "vitest";
import { resolveThemeAsset } from "./asset-resolver";

describe("resolveThemeAsset", () => {
  it("builds the protocol URL for a plain theme-relative path", () => {
    expect(resolveThemeAsset("aurora.theme", "preview/dark/bg.png")).toBe(
      "tetra-theme://aurora.theme/preview/dark/bg.png",
    );
  });

  it("strips a leading slash rather than emitting an empty first segment", () => {
    expect(resolveThemeAsset("aurora.theme", "/styles.css")).toBe(
      "tetra-theme://aurora.theme/styles.css",
    );
    expect(resolveThemeAsset("aurora.theme", "///fonts/a.woff2")).toBe(
      "tetra-theme://aurora.theme/fonts/a.woff2",
    );
  });

  it("encodes each segment on its own, keeping the separators intact", () => {
    expect(resolveThemeAsset("aurora.theme", "fonts/My Font ü.woff2")).toBe(
      "tetra-theme://aurora.theme/fonts/My%20Font%20%C3%BC.woff2",
    );
  });

  it("encodes the theme id in the host position too", () => {
    expect(resolveThemeAsset("local.a b", "styles.css")).toBe(
      "tetra-theme://local.a%20b/styles.css",
    );
  });

  it("handles a path that is only a filename", () => {
    expect(resolveThemeAsset("aurora", "styles.css")).toBe(
      "tetra-theme://aurora/styles.css",
    );
  });
});
