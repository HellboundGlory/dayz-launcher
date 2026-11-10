import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_LAYOUT } from "./settings";
import type { AccordionNode, LayoutFile, LayoutNode, TabsNode } from "../renderer/types";

const tactical = JSON.parse(
  readFileSync(
    new URL(
      "../../../src-tauri/resources/builtin-themes/builtin.tactical/layout/settings.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as LayoutFile;

function walk(node: LayoutNode | undefined, visit: (node: LayoutNode) => void): void {
  if (!node) return;
  visit(node);
  if ("children" in node && node.children) for (const child of node.children) walk(child, visit);
  if ("type" in node && node.type === "accordion") {
    for (const section of (node as AccordionNode).sections) {
      walk(section.header, visit);
      walk(section.body, visit);
    }
  }
  if ("type" in node && node.type === "tabs") {
    for (const tab of (node as TabsNode).tabs) {
      walk(tab.label, visit);
      walk(tab.content, visit);
    }
  }
}

describe("Neutral settings", () => {
  it("puts About last", () => {
    const sections: { id: string; body: LayoutNode }[] = [];
    walk(SETTINGS_LAYOUT.root, (node) => {
      if ("type" in node && node.type === "accordion") sections.push(...(node as AccordionNode).sections);
    });
    expect(sections.map((section) => section.id)).toEqual(["game", "launcher", "theme", "about"]);
    expect(sections[3].body).toEqual({ element: "settings.about" });
  });
});

describe("Tactical settings", () => {
  it("puts the About tab last and holds the About element", () => {
    const tabs: { id: string; content: LayoutNode }[] = [];
    walk(tactical.root, (node) => {
      if ("type" in node && node.type === "tabs") tabs.push(...(node as TabsNode).tabs);
    });
    expect(tabs.map((tab) => tab.id)).toEqual(["game", "launcher", "themes", "about"]);
    expect(JSON.stringify(tabs[3].content)).toContain("settings.about");
  });
});
