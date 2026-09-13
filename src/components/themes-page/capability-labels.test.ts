/** The two pure functions the import/export dialogs read a manifest with: the
 * capability strings the backend validated -> display labels, and what an export
 * actually packages. Both stood in for hand-written/plain-text copy that had
 * already drifted, so these pin the mapping rather than the markup. */
import { describe, expect, it } from "vitest";
import { capabilityLabels } from "./ImportThemeDialog";
import { packagedFiles } from "./ExportThemeDialog";

describe("capabilityLabels", () => {
  it("labels the capabilities a theme declares", () => {
    expect(capabilityLabels(["css", "fonts", "assets"])).toEqual([
      "Custom CSS",
      "Fonts",
      "Assets",
    ]);
  });

  it("drops capabilities that aren't present rather than placeholdering them", () => {
    expect(capabilityLabels(["tokens"])).toEqual(["Tokens"]);
  });

  it("returns nothing for the empty array every pre-Advanced theme carries", () => {
    expect(capabilityLabels([])).toEqual([]);
  });

  it("ignores a string the label table has no entry for", () => {
    expect(capabilityLabels(["tokens", "settings", "wat"])).toEqual(["Tokens"]);
  });

  it("lists in a fixed order whatever order the manifest uses", () => {
    expect(capabilityLabels(["fonts", "tokens", "layout", "css"])).toEqual([
      "Tokens",
      "Layout",
      "Custom CSS",
      "Fonts",
    ]);
  });

  it("narrows to a subset when asked, so callers can describe some as files", () => {
    expect(capabilityLabels(["tokens", "layout", "css", "fonts", "assets"], [
      "css",
      "fonts",
      "assets",
    ])).toEqual(["Custom CSS", "Fonts", "Assets"]);
  });
});

describe("packagedFiles", () => {
  it("always names the manifest and tokens", () => {
    expect(packagedFiles({ layout: null, capabilities: [] })).toEqual([
      "theme.json",
      "tokens.json",
    ]);
  });

  it("names layout.json only when the theme has a layout", () => {
    expect(packagedFiles({ layout: { slots: {} }, capabilities: ["tokens", "layout"] })).toEqual([
      "theme.json",
      "tokens.json",
      "layout.json",
    ]);
  });

  it("names the extra files a theme's capabilities imply", () => {
    expect(packagedFiles({ layout: null, capabilities: ["tokens", "css", "fonts"] })).toEqual([
      "theme.json",
      "tokens.json",
      "Custom CSS",
      "Fonts",
    ]);
  });

  it("does not list layout twice when the capability is declared alongside a layout", () => {
    expect(
      packagedFiles({ layout: { slots: {} }, capabilities: ["layout", "css"] }),
    ).toEqual(["theme.json", "tokens.json", "layout.json", "Custom CSS"]);
  });
});
