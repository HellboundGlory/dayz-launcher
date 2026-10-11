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
}

afterEach(reset);

const render = (node: React.ReactElement, contextValue: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={contextValue}>{node}</ElementContextProvider>,
  );

describe("SettingsBack and SettingsDone", () => {
  const buttons = [
    { el: "settings.back", Component: SettingsBack },
    { el: "settings.done", Component: SettingsDone },
  ];
  const displays = [
    { name: "default", display: undefined, icon: false, label: true },
    { name: "iconLabel", display: "iconLabel", icon: true, label: true },
    { name: "icon", display: "icon", icon: true, label: false },
    { name: "label", display: "label", icon: false, label: true },
  ];

  it.each(buttons.flatMap((b) => displays.map((d) => ({ ...b, ...d }))))(
    "$el $name display: icon $icon, label $label",
    ({ Component, el, display, icon, label }) => {
      const html = render(<Component options={display ? { display } : undefined} />);
      expect(html).toContain(`data-el="${el}"`);
      expect(html.includes('data-part="icon"')).toBe(icon);
      expect(html.includes('data-part="label"')).toBe(label);
    },
  );

  it("honours the icon option", () => {
    const html = render(<SettingsBack options={{ display: "icon", icon: "x" }} />);
    expect(html).toContain("lucide-x");
  });
});

describe("SettingsTitle", () => {
  it("renders the text part", () => {
    const html = render(<SettingsTitle />);
    expect(html).toContain('data-el="settings.title"');
    expect(html).toContain('data-part="text"');
  });
});

describe("SettingsProfileName", () => {
  it("renders label, hint and control parts bound to the store", () => {
    storeState.profileName = "Survivor42";
    const html = render(<SettingsProfileName />);
    expect(html).toContain('data-el="settings.profileName"');
    expect(html).toContain('data-part="label"');
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
    expect(html).toContain('value=""');
  });
});

describe("SettingsWorkshopPath", () => {
  it("renders read-only", () => {
    const html = render(<SettingsWorkshopPath />);
    expect(html).toContain('data-el="settings.workshopPath"');
    expect(html).toContain('readOnly=""');
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
    const off = render(<SettingsMinimiseToTray />);
    expect(off).toContain('data-el="settings.minimiseToTray"');
    expect(off).not.toContain('data-state="checked"');

    storeState.minimiseToTray = true;
    const on = render(<SettingsMinimiseToTray />);
    expect(on).toContain('data-state="checked"');
    expect(on).toContain('data-part="box"');
    expect(on).toContain("checked=\"\"");
  });
});

describe("SettingsCloseToTray", () => {
  it("renders the label and hint parts", () => {
    const html = render(<SettingsCloseToTray />);
    expect(html).toContain('data-el="settings.closeToTray"');
    expect(html).toContain('data-part="hint"');
  });
});

describe("SettingsStartWithWindows", () => {
  it("renders the checkbox and the debug-build note", () => {
    const html = render(<SettingsStartWithWindows />);
    expect(html).toContain('data-el="settings.startWithWindows"');
    expect(html).toContain('data-part="note"');
    expect(html).toContain("debug build");
  });
});

describe("SettingsStartMinimised", () => {
  it("is disabled until startWithWindows is on", () => {
    const disabled = render(<SettingsStartMinimised />);
    expect(disabled).toContain('data-el="settings.startMinimised"');
    expect(disabled).toContain("disabled=\"\"");
    expect(disabled).toContain('data-state="disabled"');

    storeState.startWithWindows = true;
    storeState.startMinimised = true;
    const enabled = render(<SettingsStartMinimised />);
    expect(enabled).not.toContain("disabled=\"\"");
    expect(enabled).toContain('data-state="checked"');
  });
});

describe("SettingsDiscordPresence", () => {
  it("follows discordRichPresence", () => {
    storeState.discordRichPresence = false;
    const html = render(<SettingsDiscordPresence />);
    expect(html).toContain('data-el="settings.discordPresence"');
    expect(html).not.toContain('data-state="checked"');
  });
});

describe("SettingsDataFolder", () => {
  it("renders the label and a read-only control", () => {
    const html = render(<SettingsDataFolder />);
    expect(html).toContain('data-el="settings.dataFolder"');
    expect(html).toContain('readOnly=""');
  });
});

describe("SettingsOpenDataFolder", () => {
  it("is disabled until the data folder path resolves", () => {
    const html = render(<SettingsOpenDataFolder />);
    expect(html).toContain('data-el="settings.openDataFolder"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain("disabled=\"\"");
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

  it.each([
    { name: "title", Component: SettingsSectionTitle },
    { name: "description", Component: SettingsSectionDescription },
    { name: "icon", Component: SettingsSectionIcon },
  ])("renders the section $name as inline markup, since it sits inside a button", ({ Component }) => {
    expect(render(<Component options={{ section: "game" }} />)).not.toContain("<div");
  });

  it("renders nothing for an unknown section", () => {
    expect(render(<SettingsSectionTitle options={{ section: "nope" }} />)).toBe("");
    expect(render(<SettingsSectionDescription options={{ section: "nope" }} />)).toBe("");
    expect(render(<SettingsSectionIcon options={{ section: "nope" }} />)).toBe("");
  });

  it("defaults to the section's own icon and honours the icon option", () => {
    const html = render(<SettingsSectionIcon options={{ section: "theme" }} />);
    expect(html).toContain('data-el="settings.sectionIcon"');
    expect(html).toContain('data-part="icon"');

    expect(render(<SettingsSectionIcon options={{ section: "theme", icon: "star" }} />)).toContain("lucide-star");
    expect(render(<SettingsSectionIcon options={{ section: "theme", icon: "none" }} />)).not.toContain("<svg");
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
