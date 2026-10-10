import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "../elements/context";
import { isElementInLayout } from "../layout-query";
import { LayoutRenderer } from "../renderer/layout-renderer";
import { MODS_LAYOUT } from "./mods";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mods view", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("view:mods", MODS_LAYOUT);
  });

  it("mods view contains view:mods required elements and modSelection panel", () => {
    expect(isElementInLayout(MODS_LAYOUT, "notice.modsError")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "notice.modsCached")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "notice.modsResult")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "list.mods")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.name")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.status")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.size")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.updated")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.subscribed")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.update")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.openInSteam")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.openFolder")).toBe(true);
    expect(isElementInLayout(MODS_LAYOUT, "mod.reinstall")).toBe(true);
  });

  it("renders mods view without throwing", () => {
    const mockMod = {
      workshop_id: "1",
      title: "Community Framework",
      state: "ready",
      size_on_disk: "5242880",
      time_updated: Math.floor(Date.now() / 1000) - 3600,
      time_added_to_user_list: Math.floor(Date.now() / 1000) - 3600,
      install_timestamp: 0,
      locally_disabled: false,
    };

    const html = renderToStaticMarkup(
      createElement(
        ElementContextProvider,
        { value: { selectedMod: mockMod } },
        createElement(LayoutRenderer, { file: MODS_LAYOUT }),
      ),
    );
    expect(html).toContain('data-el="list.mods"');
    expect(html).toContain("Community Framework");
    expect(html).toContain('data-el="mod.status"');
  });
});
