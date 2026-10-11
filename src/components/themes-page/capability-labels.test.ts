/** The two pure functions the import/export dialogs read a manifest with: the
 * capability strings the backend validated -> display labels, and what an export
 * actually packages. Both stood in for hand-written/plain-text copy that had
 * already drifted, so these pin the mapping rather than the markup. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilityLabel, capabilityLabels } from "./capability-labels";
import { packagedFiles } from "./export-theme-dialog";

/** The backend gate every manifest passes: a capability it rejects never reaches
 * a theme, so the label table has to cover exactly this set. */
function backendCapabilities(): string[] {
  const source = readFileSync(
    new URL("../../../src-tauri/src/theme/archive.rs", import.meta.url),
    "utf8",
  );
  const declared = source.match(/const CAPABILITIES: \[&str; \d+\] = \[([\s\S]*?)\];/);
  if (declared === null) throw new Error("no CAPABILITIES list in archive.rs");
  return [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("capabilityLabels", () => {
  it("labels every capability a theme can declare", () => {
    expect(capabilityLabels(["tokens", "css", "fonts", "images", "layout", "settings"])).toEqual([
      "Tokens",
      "Custom CSS",
      "Fonts",
      "Images",
      "Layout",
      "Settings",
    ]);
  });

  it("covers every capability the backend accepts", () => {
    const capabilities = backendCapabilities();
    expect(capabilityLabels(capabilities)).toHaveLength(capabilities.length);
  });

  it("drops capabilities and unknown strings the label table has no entry for", () => {
    expect(capabilityLabels(["tokens"])).toEqual(["Tokens"]);
    expect(capabilityLabels(["tokens", "wat"])).toEqual(["Tokens"]);
  });

  it("returns nothing for the empty array every pre-Advanced theme carries", () => {
    expect(capabilityLabels([])).toEqual([]);
  });

  it("lists in a fixed order whatever order the manifest uses", () => {
    expect(capabilityLabels(["settings", "fonts", "tokens", "css"])).toEqual([
      "Tokens",
      "Custom CSS",
      "Fonts",
      "Settings",
    ]);
  });

  it("narrows to a subset when asked, so callers can describe some as files", () => {
    expect(capabilityLabels(["tokens", "layout", "css", "fonts", "images"], [
      "css",
      "fonts",
      "images",
    ])).toEqual(["Custom CSS", "Fonts", "Images"]);
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

  it("names the settings schema a theme declares", () => {
    expect(packagedFiles({ layouts: {}, capabilities: ["tokens", "settings"] })).toEqual([
      "theme.json",
      "tokens.json",
      "Settings",
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
