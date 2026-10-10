import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "../elements/context";
import { isElementInLayout } from "../layout-query";
import { SettingsHost } from "../interaction/settings-host";
import { SETTINGS_LAYOUT } from "./settings";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral settings", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("settings", SETTINGS_LAYOUT);
  });

  it("settings layout contains all 16 required settings elements", () => {
    const settingsReqs = [
      "settings.back",
      "settings.themeManagement",
      "settings.profileName",
      "settings.dayzPath",
      "settings.detectPaths",
      "settings.workshopPath",
      "settings.launchParams",
      "settings.minimiseToTray",
      "settings.closeToTray",
      "settings.onJoin",
      "settings.startWithWindows",
      "settings.startMinimised",
      "settings.discordPresence",
      "settings.dataFolder",
      "settings.openDataFolder",
      "settings.autoRefresh",
    ];
    for (const id of settingsReqs) {
      expect(isElementInLayout(SETTINGS_LAYOUT, id)).toBe(true);
    }
  });

  it("renders settings layout with accordion and overlay presentation", () => {
    const html = renderToStaticMarkup(
      createElement(
        ElementContextProvider,
        null,
        createElement(SettingsHost, { file: SETTINGS_LAYOUT }),
      ),
    );
    expect(html).toContain('data-settings-host=""');
    expect(html).toContain('data-presentation="overlay"');
    expect(html).toContain('data-region="r-main"');
    expect(html).toContain('data-el="settings.back"');
    expect(html).toContain('data-accordion="r-settings"');
    expect(html).toContain("Game");
    expect(html).toContain("Launcher");
    expect(html).toContain("Theme");
  });
});
