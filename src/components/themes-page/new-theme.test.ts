/** Which create path a "New theme" pick leads to. The duplicate path's own id
 * shape (`local.<slug>`) is what the rest of the store already keys on, so this
 * pins that a scaffolded theme lands on an id of the same shape — and that a
 * pick naming a template this build doesn't ship calls nothing at all. */
import { describe, expect, it } from "vitest";
import { byTier, newThemeRequest } from "./new-theme";
import type { ThemeSummary } from "@/types/theme";

const template = (id: string, tier = "basic"): ThemeSummary => ({
  id,
  name: id,
  author: "Tetra Launcher",
  version: "1.0.0",
  themeApi: "1.0",
  minimumLauncherVersion: "2.6.0",
  tier,
  description: "",
  preview: null,
  tags: [],
  capabilities: ["tokens"],
});

const TEMPLATES = [template("starter.basic"), template("starter.advanced")];

describe("newThemeRequest", () => {
  it("sends a blank pick down the existing duplicate-from-neutral path", () => {
    expect(newThemeRequest("blank", "New Theme", TEMPLATES)).toEqual({
      kind: "blank",
      sourceId: "neutral",
      name: "New Theme",
    });
  });

  it("scaffolds a chosen template under a local.<slug> id, as a duplicate would", () => {
    expect(newThemeRequest("starter.advanced", "My Theme 2", TEMPLATES)).toEqual({
      kind: "template",
      templateId: "starter.advanced",
      newId: "local.my-theme-2",
      name: "My Theme 2",
    });
  });

  it("refuses a choice no template matches rather than calling the backend with it", () => {
    expect(newThemeRequest("starter.expert", "New Theme", TEMPLATES)).toBeNull();
    expect(newThemeRequest("../../escape", "New Theme", TEMPLATES)).toBeNull();
  });

  it("still offers blank when this build ships no templates at all", () => {
    expect(newThemeRequest("blank", "New Theme", [])).toEqual({
      kind: "blank",
      sourceId: "neutral",
      name: "New Theme",
    });
    expect(newThemeRequest("starter.basic", "New Theme", [])).toBeNull();
  });
});

describe("byTier", () => {
  it("lists the tiers in the order they build on each other, not alphabetically", () => {
    const listed = byTier([
      template("starter.expert", "expert"),
      template("starter.basic", "basic"),
      template("starter.advanced", "advanced"),
    ]);

    expect(listed.map((t) => t.id)).toEqual([
      "starter.basic",
      "starter.advanced",
      "starter.expert",
    ]);
  });

  it("keeps a template whose tier it does not know rather than dropping it", () => {
    const listed = byTier([
      template("starter.future", "future"),
      template("starter.basic", "basic"),
    ]);

    expect(listed.map((t) => t.id)).toEqual(["starter.basic", "starter.future"]);
  });
});
