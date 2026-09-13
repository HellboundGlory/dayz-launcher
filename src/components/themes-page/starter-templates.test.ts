/** The Expert starter's `components/server-row.json` and `layout.json` name
 * slot and child ids — and those ids are only real if `slots.ts` has them. The
 * backend holds the two files to their own shape (§4.3/§4.4); this is the other
 * half, the part that needs the registry, which lives here. A template that
 * referenced a child the launcher no longer has would load as a theme that
 * silently drops content, which is exactly what this catches.
 *
 * The files are imported rather than read from disk: this project has no
 * `@types/node`, and an import keeps the assertions on the same bytes the
 * bundler ships.
 */
import { describe, expect, it } from "vitest";
import { SLOTS } from "@/theme/slots";
import { resolveLayout } from "@/theme/layout-store";
import advancedLayout from "../../../src-tauri/resources/starter-themes/starter.advanced/layout.json";
import expertLayout from "../../../src-tauri/resources/starter-themes/starter.expert/layout.json";
import expertRow from "../../../src-tauri/resources/starter-themes/starter.expert/components/server-row.json";
import basicManifest from "../../../src-tauri/resources/starter-themes/starter.basic/theme.json";

const childIds = (slotId: string) =>
  SLOTS.find((slot) => slot.id === slotId)?.children.map((child) => child.id) ?? [];

const slotIds = SLOTS.map((slot) => slot.id);

/** A §4.3 node, as much of it as the walk below reads. */
interface ComponentNode {
  type: string;
  ref?: string;
  children?: ComponentNode[];
}

function coreRefs(node: ComponentNode): string[] {
  if (node.type === "core") return [node.ref ?? ""];
  return (node.children ?? []).flatMap(coreRefs);
}

describe("the advanced starter's layout", () => {
  it("resolves with no issues against the real slot registry", () => {
    const { issues, resolved } = resolveLayout(SLOTS, advancedLayout);

    expect(issues).toEqual([]);
    // ...and its two deliberate changes are what the resolver reports.
    expect(resolved["shell.footer"].hidden).toEqual(["uiScaleSlider"]);
    expect(resolved["shell.footer"].children).toEqual([
      "steamStateChip",
      "schemeToggle",
      "serverCounts",
    ]);
  });

  it("never hides a required child, so its footer keeps the Steam chip", () => {
    const { resolved } = resolveLayout(SLOTS, advancedLayout);

    const required = SLOTS.find((slot) => slot.id === "shell.footer")!.children
      .filter((child) => child.required)
      .map((child) => child.id);
    for (const id of required) {
      expect(resolved["shell.footer"].children).toContain(id);
    }
  });

  it("only mentions slots the registry has", () => {
    for (const slotId of Object.keys(advancedLayout.slots)) {
      expect(slotIds).toContain(slotId);
    }
  });
});

describe("the expert starter's layout", () => {
  it("resolves with no issues against the real slot registry", () => {
    const { issues, resolved } = resolveLayout(SLOTS, expertLayout);

    expect(issues).toEqual([]);
    // A reorder only means something where the theme actually disagrees.
    expect(resolved["server.row"].children).toEqual(
      expect.arrayContaining(["name", "modStatusBadge"]),
    );
    expect(resolved["mods.row"].hidden).toEqual(["updatedLabel"]);
    // Its sidebar params are the literal values the resolver accepts.
    expect(resolved["shell.sidebar"].params).toEqual({
      position: "left",
      width: "208px",
      collapsedWidth: "52px",
      defaultCollapsed: false,
    });
  });

  it("only mentions slots the registry has", () => {
    for (const slotId of Object.keys(expertLayout.slots)) {
      expect(slotIds).toContain(slotId);
    }
  });
});

describe("the expert starter's server-row composition", () => {
  it("references only children the server.row slot really has", () => {
    expect(expertRow.slot).toBe("server.row");

    const refs = coreRefs(expertRow.root as ComponentNode);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(childIds("server.row")).toContain(ref);
    }
  });
});

describe("the basic starter", () => {
  it("declares the one capability its files back up", () => {
    expect(basicManifest.id).toBe("starter.basic");
    expect(basicManifest.tier).toBe("basic");
    expect(basicManifest.capabilities).toEqual(["tokens"]);
    // A Basic package ships no layout, so the default render — nothing hidden,
    // nothing reordered — is exactly what its tier promises.
    expect(resolveLayout(SLOTS, null).resolved["shell.footer"].hidden).toEqual([]);
  });
});
