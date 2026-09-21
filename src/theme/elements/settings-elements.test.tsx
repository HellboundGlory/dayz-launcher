import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import {
  SettingsBack,
  SettingsDone,
  SettingsTitle,
  SettingsProfileName,
  SettingsDayzPath,
  SettingsWorkshopPath,
  SettingsLaunchParams,
  SettingsOnJoin,
  SettingsMinimiseToTray,
  SettingsCloseToTray,
  SettingsStartWithWindows,
  SettingsStartMinimised,
  SettingsDiscordPresence,
  SettingsDataFolder,
  SettingsOpenDataFolder,
  SettingsAutoRefresh,
  SettingsThemeManagement,
  SettingsSectionTitle,
  SettingsSectionDescription,
  SettingsSectionIcon,
  SettingsGroupTitle,
} from "./settings-elements";

const storeState = {
  profileName: "",
  steamPath: null as string | null,
  dayzPath: null as string | null,
  workshopPath: null as string | null,
  launchParams: [] as string[],
  closeToTray: true,
  minimiseToTray: false,
  autoRefreshIntervalSecs: 60,
  startWithWindows: false,
  startMinimised: false,
  onJoin: "stay" as "stay" | "tray" | "close",
  discordRichPresence: true,
  setSetting: vi.fn((key: string, value: unknown) => {
    (storeState as unknown as Record<string, unknown>)[key] = value;
  }),
};

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock("@/lib/tauri", () => ({
  discoverSteamPaths: vi.fn(),
  dataFolderPath: vi.fn(() => Promise.resolve("/data/tetra")),
  openDataFolder: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/components/themes-page/ThemesSection", () => ({
  ThemesSection: ({ devMode }: { devMode: boolean }) => (
    <div data-mock="ThemesSection" data-dev-mode={String(devMode)} />
  ),
}));

function reset() {
  storeState.profileName = "";
  storeState.steamPath = null;
  storeState.dayzPath = null;
  storeState.workshopPath = null;
  storeState.launchParams = [];
  storeState.closeToTray = true;
  storeState.minimiseToTray = false;
  storeState.autoRefreshIntervalSecs = 60;
  storeState.startWithWindows = false;
  storeState.startMinimised = false;
  storeState.onJoin = "stay";
  storeState.discordRichPresence = true;
  storeState.setSetting.mockClear();
}

afterEach(reset);

const render = (node: React.ReactElement, contextValue: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={contextValue}>{node}</ElementContextProvider>,
  );

describe("SettingsBack", () => {
  it("renders icon and label parts and calls onCloseSettings", () => {
    const onCloseSettings = vi.fn();
    const html = render(<SettingsBack options={{ display: "iconLabel" }} />, { onCloseSettings });
    expect(html).toContain('data-el="settings.back"');
    expect(html).toContain('data-part="icon"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain("Back");
  });

  it("defaults to label-only display", () => {
    const html = render(<SettingsBack />);
    expect(html).not.toContain('data-part="icon"');
    expect(html).toContain('data-part="label"');
  });

  it("hides the label when display is icon-only", () => {
    const html = render(<SettingsBack options={{ display: "icon" }} />);
    expect(html).not.toContain('data-part="label"');
    expect(html).toContain('data-part="icon"');
  });

  it("hides the icon when display is label-only", () => {
    const html = render(<SettingsBack options={{ display: "label" }} />);
    expect(html).not.toContain('data-part="icon"');
    expect(html).toContain('data-part="label"');
  });
});

describe("SettingsDone", () => {
  it("renders icon and label parts and calls onCloseSettings on click", () => {
    const onCloseSettings = vi.fn();
    const html = render(<SettingsDone options={{ display: "iconLabel" }} />, { onCloseSettings });
    expect(html).toContain('data-el="settings.done"');
    expect(html).toContain('data-part="icon"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain("Done");
  });

  it("defaults to label-only display", () => {
    const html = render(<SettingsDone />);
    expect(html).not.toContain('data-part="icon"');
    expect(html).toContain('data-part="label"');
  });

  it("hides the label when display is icon-only", () => {
    const html = render(<SettingsDone options={{ display: "icon" }} />);
    expect(html).not.toContain('data-part="label"');
    expect(html).toContain('data-part="icon"');
  });

  it("hides the icon when display is label-only", () => {
    const html = render(<SettingsDone options={{ display: "label" }} />);
    expect(html).not.toContain('data-part="icon"');
    expect(html).toContain('data-part="label"');
  });
});

describe("SettingsTitle", () => {
  it("renders the text part", () => {
    const html = render(<SettingsTitle />);
    expect(html).toContain('data-el="settings.title"');
    expect(html).toContain('data-part="text"');
    expect(html).toContain("Settings");
  });
});

describe("SettingsProfileName", () => {
  it("renders label, hint and control parts bound to the store", () => {
    storeState.profileName = "Survivor42";
    const html = render(<SettingsProfileName />);
    expect(html).toContain('data-el="settings.profileName"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain("In-Game Name");
    expect(html).toContain('data-part="hint"');
    expect(html).toContain('data-part="control"');
    expect(html).toContain('value="Survivor42"');
  });

  it("drops the hint part when showHint is false", () => {
    const html = render(<SettingsProfileName options={{ showHint: false }} />);
    expect(html).not.toContain('data-part="hint"');
  });
});

describe("SettingsDayzPath", () => {
  it("renders an empty value when dayzPath is null", () => {
    const html = render(<SettingsDayzPath />);
    expect(html).toContain('data-el="settings.dayzPath"');
    expect(html).toContain("DayZ Install Path");
  });
});

describe("SettingsWorkshopPath", () => {
  it("renders read-only with the not-detected placeholder", () => {
    const html = render(<SettingsWorkshopPath />);
    expect(html).toContain('data-el="settings.workshopPath"');
    expect(html).toContain("Workshop Content");
    expect(html).toContain("Not detected yet");
    expect(html).toContain("readonly");
  });
});

describe("SettingsLaunchParams", () => {
  it("joins launch params with newlines", () => {
    storeState.launchParams = ["-noPause", "-cpuCount=4"];
    const html = render(<SettingsLaunchParams />);
    expect(html).toContain("-noPause\n-cpuCount=4");
  });
});

describe("SettingsOnJoin", () => {
  it("renders the legacy option texts", () => {
    const html = render(<SettingsOnJoin />);
    expect(html).toContain("Leave the launcher open");
    expect(html).toContain("Hide the launcher to the tray");
    expect(html).toContain("Close the launcher");
  });
});

describe("SettingsMinimiseToTray", () => {
  it("follows the store's checked state", () => {
    storeState.minimiseToTray = true;
    const html = render(<SettingsMinimiseToTray />);
    expect(html).toContain('data-el="settings.minimiseToTray"');
    expect(html).toContain('data-state="checked"');
    expect(html).toContain('data-part="box"');
    expect(html).toContain("checked=\"\"");
  });

  it("is unchecked by default", () => {
    const html = render(<SettingsMinimiseToTray />);
    expect(html).not.toContain('data-state="checked"');
  });
});

describe("SettingsCloseToTray", () => {
  it("renders the label and hint", () => {
    const html = render(<SettingsCloseToTray />);
    expect(html).toContain("Close to the system tray");
    expect(html).toContain('data-part="hint"');
  });
});

describe("SettingsStartWithWindows", () => {
  it("renders the checkbox and the debug-build note", () => {
    const html = render(<SettingsStartWithWindows />);
    expect(html).toContain('data-el="settings.startWithWindows"');
    expect(html).toContain("Start with Windows");
    expect(html).toContain('data-part="note"');
    expect(html).toContain("debug build");
  });
});

describe("SettingsStartMinimised", () => {
  it("is disabled when startWithWindows is false", () => {
    storeState.startWithWindows = false;
    const html = render(<SettingsStartMinimised />);
    expect(html).toContain('data-el="settings.startMinimised"');
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain('data-state="disabled"');
  });

  it("is enabled and reflects checked when startWithWindows is true", () => {
    storeState.startWithWindows = true;
    storeState.startMinimised = true;
    const html = render(<SettingsStartMinimised />);
    expect(html).not.toContain("disabled=\"\"");
    expect(html).toContain('data-state="checked"');
  });
});

describe("SettingsDiscordPresence", () => {
  it("follows discordRichPresence", () => {
    storeState.discordRichPresence = false;
    const html = render(<SettingsDiscordPresence />);
    expect(html).not.toContain('data-state="checked"');
    expect(html).toContain("Show Rich Presence in Discord");
  });
});

describe("SettingsDataFolder", () => {
  it("renders the label and a read-only control", () => {
    const html = render(<SettingsDataFolder />);
    expect(html).toContain('data-el="settings.dataFolder"');
    expect(html).toContain("Data folder");
    expect(html).toContain("readonly");
  });
});

describe("SettingsOpenDataFolder", () => {
  it("renders the Open label", () => {
    const html = render(<SettingsOpenDataFolder />);
    expect(html).toContain('data-el="settings.openDataFolder"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain("Open");
  });
});

describe("SettingsAutoRefresh", () => {
  it("renders all refresh interval options", () => {
    const html = render(<SettingsAutoRefresh />);
    expect(html).toContain("Never");
    expect(html).toContain("Every 30 seconds");
    expect(html).toContain("Every minute");
    expect(html).toContain("Every 5 minutes");
    expect(html).toContain("Every 10 minutes");
  });
});

describe("SettingsThemeManagement", () => {
  it("renders ThemesSection with devMode from context", () => {
    const html = render(<SettingsThemeManagement />, { devMode: true });
    expect(html).toContain('data-el="settings.themeManagement"');
    expect(html).toContain('data-mock="ThemesSection"');
    expect(html).toContain('data-dev-mode="true"');
  });
});

describe("SettingsSectionTitle / sectionDescription / sectionIcon", () => {
  it("renders the legacy section title, description and icon", () => {
    const title = render(<SettingsSectionTitle options={{ section: "game" }} />);
    expect(title).toContain('data-el="settings.sectionTitle"');
    expect(title).toContain("Game");

    const description = render(<SettingsSectionDescription options={{ section: "launcher" }} />);
    expect(description).toContain("Tray, startup, refresh cadence, Discord presence");

    const icon = render(<SettingsSectionIcon options={{ section: "theme" }} />);
    expect(icon).toContain('data-el="settings.sectionIcon"');
    expect(icon).toContain('data-part="icon"');
  });

  it("renders nothing for an unknown section", () => {
    expect(render(<SettingsSectionTitle options={{ section: "nope" }} />)).toBe("");
    expect(render(<SettingsSectionDescription options={{ section: "nope" }} />)).toBe("");
    expect(render(<SettingsSectionIcon options={{ section: "nope" }} />)).toBe("");
  });
});

describe("SettingsGroupTitle", () => {
  it("renders the legacy group titles", () => {
    expect(render(<SettingsGroupTitle options={{ group: "window" }} />)).toContain("Window");
    expect(render(<SettingsGroupTitle options={{ group: "startup" }} />)).toContain("Startup");
    expect(render(<SettingsGroupTitle options={{ group: "discord" }} />)).toContain("Discord");
  });

  it("renders nothing for an unknown group", () => {
    expect(render(<SettingsGroupTitle options={{ group: "nope" }} />)).toBe("");
  });
});
