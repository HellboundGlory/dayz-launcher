/** The two pure functions the import/export dialogs read a manifest with: the
 * capability strings the backend validated -> display labels, and what an export
 * actually packages. Both stood in for hand-written/plain-text copy that had
 * already drifted, so these pin the mapping rather than the markup. */
import { describe, expect, it } from "vitest";
import { capabilityLabel, capabilityLabels } from "./capability-labels";
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

describe("capabilityLabel", () => {
  it("returns Custom layout when layout is present, whatever else is", () => {
    expect(capabilityLabel(["layout"])).toBe("Custom layout");
    expect(capabilityLabel(["tokens", "layout", "css", "fonts"])).toBe("Custom layout");
  });

  it("returns Styled for css or fonts without layout", () => {
    expect(capabilityLabel(["css"])).toBe("Styled");
    expect(capabilityLabel(["fonts"])).toBe("Styled");
    expect(capabilityLabel(["tokens", "css", "fonts"])).toBe("Styled");
  });

  it("returns Colours for tokens alone and for an empty list", () => {
    expect(capabilityLabel(["tokens"])).toBe("Colours");
    expect(capabilityLabel([])).toBe("Colours");
  });
});

describe("packagedFiles", () => {
  it("always names the manifest and tokens", () => {
    expect(packagedFiles({ layouts: undefined, capabilities: [] })).toEqual([
      "theme.json",
      "tokens.json",
    ]);
  });

  it("names each layout file the theme ships", () => {
    expect(
      packagedFiles({
        layouts: {
          "layout/shell.json": { schemaVersion: 2 },
          "layout/views/mods.json": { schemaVersion: 2 },
        },
        capabilities: ["tokens", "layout"],
      }),
    ).toEqual([
      "theme.json",
      "tokens.json",
      "layout/shell.json",
      "layout/views/mods.json",
    ]);
  });

  it("names the extra files a theme's capabilities imply", () => {
    expect(packagedFiles({ layouts: {}, capabilities: ["tokens", "css", "fonts"] })).toEqual([
      "theme.json",
      "tokens.json",
      "Custom CSS",
      "Fonts",
    ]);
  });

  it("does not name the layout capability twice when the theme ships layout files", () => {
    expect(
      packagedFiles({
        layouts: { "layout/shell.json": { schemaVersion: 2 } },
        capabilities: ["layout", "css"],
      }),
    ).toEqual(["theme.json", "tokens.json", "layout/shell.json", "Custom CSS"]);
  });
});
