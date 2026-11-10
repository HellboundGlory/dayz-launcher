import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { SECS } from "./settings-controls";
import { useUpdateStore } from "@/stores/update-store";
import {
  SettingsAbout,
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
  SettingsAppMenu,
  AppMenuRow,
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
  discordShowServer: true,
  startWindow: true,
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
  appMenuStatus: vi.fn(() => Promise.resolve({ available: false, installed: false })),
  addToAppMenu: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/components/themes-page/themes-section", () => ({
  ThemesSection: ({ devMode }: { devMode: boolean }) => (
    <div data-mock="ThemesSection" data-dev-mode={String(devMode)} />
  ),
}));

const openLinkMock = vi.fn();
vi.mock("@/lib/external-link", () => ({
  openExternalUrl: (url: string) => {
    openLinkMock(url);
    return Promise.resolve();
  },
}));

// SSR takes zustand's initial-state snapshot, so route the hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/update-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/update-store")>();
  return { ...actual, useUpdateStore: liveHook(actual.useUpdateStore) };
});

// Captures props by data-part since renderToStaticMarkup drops event handlers.
const captured: Record<string, Record<string, unknown>> = {};
const capturedClicks: Record<string, () => void> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") {
        captured[part] = props;
        if (typeof props.onClick === "function") capturedClicks[part] = props.onClick as () => void;
      }
      const label = props?.["aria-label"];
      if (typeof label === "string" && typeof props.onClick === "function") {
        capturedClicks[label] = props.onClick as () => void;
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

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
  storeState.discordShowServer = true;
  storeState.startWindow = true;
  storeState.setSetting.mockClear();
  openLinkMock.mockClear();
  for (const key of Object.keys(captured)) delete captured[key];
  for (const key of Object.keys(capturedClicks)) delete capturedClicks[key];
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

  it("renders the four toggles with their names and flags above the text box", () => {
    const html = render(<SettingsLaunchParams />);
    expect(html).toContain('data-part="toggles-label"');
    expect(html).toContain("Launch options");
    const rows = html.match(/data-part="toggle"/g) ?? [];
    expect(rows).toHaveLength(4);
    for (const [name, flag] of [
      ["Skip intro", "-skipIntro"],
      ["No splash screen", "-nosplash"],
      ["Keep running in the background", "-noPause"],
      ["Windowed", "-window"],
    ]) {
      expect(html).toContain(name);
      expect(html).toContain(flag);
    }
    expect(html.indexOf('data-part="toggles-label"')).toBeLessThan(html.indexOf("<textarea"));
  });

  it("ticks the toggle whose flag is typed in the box", () => {
    storeState.launchParams = ["-window"];
    const html = render(<SettingsLaunchParams />);
    expect(html.match(/data-state="checked"/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/data-state="checked"[^>]*>[\s\S]*?data-part="name"[^>]*>Windowed</);
    expect(html).toContain('checked=""');
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

describe("SettingsOnJoin", () => {
  it("offers the starting window checkbox below the select", () => {
    const html = render(<SettingsOnJoin />);
    expect(html).toContain('data-el="settings.onJoin"');
    expect(html).toContain("Show the starting window");
    expect(captured["box"]?.checked).toBe(true);
  });

  it("writes the checkbox through to the setting", () => {
    render(<SettingsOnJoin />);
    (captured["box"]?.onChange as (e: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });

    expect(storeState.setSetting).toHaveBeenCalledWith("startWindow", false);
  });
});

describe("SettingsDiscordPresence", () => {
  it("follows discordRichPresence", () => {
    storeState.discordRichPresence = false;
    const html = render(<SettingsDiscordPresence />);
    expect(html).toContain('data-el="settings.discordPresence"');
    expect(html).not.toMatch(/data-el="settings.discordPresence"[^>]*data-state="checked"/);
  });

  it("nests the server-name box under it, disabled while Rich Presence is off", () => {
    const nested = (html: string) => html.slice(html.indexOf('data-part="showServer"'));

    storeState.discordRichPresence = false;
    const disabled = nested(render(<SettingsDiscordPresence />));
    expect(disabled).toContain("Show which server I&#x27;m on");
    expect(disabled).toContain("Off: Discord shows only &quot;Playing DayZ&quot;.");
    expect(disabled).toContain('disabled=""');

    storeState.discordRichPresence = true;
    expect(nested(render(<SettingsDiscordPresence />))).not.toContain('disabled=""');
  });

  it("writes the nested box through to discordShowServer", () => {
    render(<SettingsDiscordPresence />);
    // The nested row is drawn last, so its box is the one captured.
    (captured["box"]?.onChange as (e: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });
    expect(storeState.setSetting).toHaveBeenCalledWith("discordShowServer", false);
  });
});

describe("SettingsAppMenu", () => {
  it("renders nothing until the status says it is available", () => {
    expect(render(<SettingsAppMenu />)).toBe("");
  });

  it("offers the button, with the move explained", () => {
    const html = render(<AppMenuRow status={{ available: false, installed: false }} />);
    expect(html).toBe("");

    const row = render(<AppMenuRow status={{ available: true, installed: false }} />);
    expect(row).toContain('data-el="settings.appMenu"');
    expect(row).toMatch(/data-part="title"[^>]*>App menu</);
    expect(row).toContain("Tetra isn&#x27;t in your app menu yet.");
    expect(row).toContain("~/Applications");
    expect(row).toContain('data-part="button"');
    expect(row).toContain("Add to app menu");
    expect(row).not.toContain('data-state="installed"');
  });

  it("says it is there and drops the button once installed", () => {
    const html = render(<AppMenuRow status={{ available: true, installed: true }} />);
    expect(html).toContain("Tetra is in your app menu.");
    expect(html).not.toContain('data-part="button"');
    expect(html).toContain('data-state="installed"');
  });

  it("shows Adding… and disables the button while busy", () => {
    const html = render(<AppMenuRow status={{ available: true, installed: false }} busy />);
    expect(html).toContain("Adding…");
    expect(html).toContain('data-state="busy"');
    expect(html).toContain('disabled=""');
  });

  it("puts a failure under the button", () => {
    const html = render(
      <AppMenuRow status={{ available: true, installed: false }} error="disk full" />,
    );
    expect(html).toContain('data-part="status"');
    expect(html).toContain("disk full");
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

describe("SettingsAbout", () => {
  const withUpdateStore = <T,>(overrides: Record<string, unknown>, fn: () => T): T => {
    const prior = useUpdateStore.getState();
    useUpdateStore.setState({ ...prior, ...overrides });
    try {
      return fn();
    } finally {
      useUpdateStore.setState(prior, true);
    }
  };

  it("renders both credit lines once each", () => {
    const html = render(<SettingsAbout />);
    expect(html).toContain('data-el="settings.about"');
    const lines = [
      "IP geolocation by DB-IP (https://db-ip.com), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), converted to a compact IPv4 range table",
      "Flag icons: country-flag-icons by catamphetamine, MIT licence",
    ];
    for (const line of lines) {
      expect(html.split(line)).toHaveLength(2);
    }
  });

  it("offers Check for updates, disabled while checking, with the status line", () => {
    const idle = withUpdateStore({ checking: false, checked: true, error: null, available: null }, () =>
      render(<SettingsAbout />),
    );
    expect(idle).toContain("Check for updates");
    expect(idle).toContain("You&#x27;re up to date.<");

    const unchecked = withUpdateStore({ checking: false, checked: false, error: null, available: null }, () =>
      render(<SettingsAbout />),
    );
    expect(unchecked).not.toContain('data-part="status"');

    const checking = withUpdateStore({ checking: true, error: null, available: null }, () =>
      render(<SettingsAbout />),
    );
    expect(checking).toContain("disabled=\"\"");
    expect(checking).toContain("Checking…");
  });

  it("shows the failure reason in the status line", () => {
    const html = withUpdateStore({ checking: false, error: "network error", available: null }, () =>
      render(<SettingsAbout />),
    );
    expect(html).toContain("Couldn&#x27;t check: network error");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("names the version on the Update button and its wrapper, and announces the status", () => {
    const html = withUpdateStore(
      { installed: true, available: { version: "3.2.0" }, error: null, checking: false, installing: false },
      () => render(<SettingsAbout />),
    );
    expect(html).toContain('aria-label="Update to version 3.2.0"');
    expect(html).toMatch(/data-part="button" data-state="update"/);
    const idle = withUpdateStore({ checking: false, error: null, available: null }, () => render(<SettingsAbout />));
    expect(idle).not.toContain('data-state="update"');
    expect(html).toMatch(/<span class="relative inline-flex" title="Version 3.2.0 is available">/);
    const checking = withUpdateStore({ checking: true, error: null, available: null }, () => render(<SettingsAbout />));
    expect(checking).toMatch(/data-part="status"[^>]*role="status"/);
  });

  it("says an install failed rather than a check when an update is waiting", () => {
    const html = withUpdateStore(
      { installed: true, available: { version: "3.2.0" }, error: "disk full", checking: false, installing: false },
      () => render(<SettingsAbout />),
    );
    expect(html).toContain("Couldn&#x27;t update: disk full");
  });

  it("installs when it is not yet known whether this copy is installed, and encodes the version in the link", () => {
    const install = vi.fn();
    withUpdateStore(
      { installed: null, available: { version: "3.2.0+a/b" }, error: null, checking: false, installing: false, install },
      () => render(<SettingsAbout />),
    );
    capturedClicks["button"]();
    expect(install).toHaveBeenCalledTimes(1);
    capturedClicks["whatsnew"]();
    expect(openLinkMock).toHaveBeenLastCalledWith(
      "https://github.com/HellboundGlory/dayz-launcher/releases/tag/v3.2.0%2Ba%2Fb",
    );
  });

  it("calls checkNow from Check for updates", () => {
    const checkNow = vi.fn();
    withUpdateStore({ checking: false, error: null, available: null, checkNow }, () =>
      render(<SettingsAbout />),
    );
    capturedClicks["button"]();
    expect(checkNow).toHaveBeenCalledTimes(1);
  });

  it("turns the button into Update with the badge and See what's new, installing on an installed copy", () => {
    const install = vi.fn();
    const html = withUpdateStore(
      { installed: true, available: { version: "3.2.0" }, error: null, checking: false, install },
      () => render(<SettingsAbout />),
    );
    expect(html).toContain(">Update<");
    expect(html).toContain('data-part="badge"');
    expect(html).toContain('title="Version 3.2.0 is available"');
    expect(html).toContain("See what&#x27;s new");
    expect(html).not.toContain("Check for updates");

    capturedClicks["button"]();
    expect(install).toHaveBeenCalledTimes(1);

    capturedClicks["whatsnew"]();
    expect(openLinkMock).toHaveBeenCalledWith(
      "https://github.com/HellboundGlory/dayz-launcher/releases/tag/v3.2.0",
    );
  });

  it("opens the download page from Update on a portable copy", () => {
    const install = vi.fn();
    withUpdateStore(
      { installed: false, available: { version: "3.2.0" }, error: null, checking: false, install },
      () => render(<SettingsAbout />),
    );
    capturedClicks["button"]();
    expect(install).not.toHaveBeenCalled();
    expect(openLinkMock).toHaveBeenCalledWith("https://tetralauncher.com/download");
  });

  it("shows the download progress while installing", () => {
    const html = withUpdateStore(
      {
        installed: true,
        available: { version: "3.2.0" },
        installing: true,
        progress: { downloaded: 50, total: 100 },
        error: null,
        checking: false,
      },
      () => render(<SettingsAbout />),
    );
    expect(html).toContain("Updating…");
    expect(html).toContain("Downloading… 50%");
    expect(html).toContain("disabled=\"\"");
  });

  it("opens the website and the source code from the two icons", () => {
    withUpdateStore({ available: null, error: null, checking: false }, () => render(<SettingsAbout />));
    capturedClicks["Website"]();
    capturedClicks["Source code on GitHub"]();
    expect(openLinkMock).toHaveBeenNthCalledWith(1, "https://tetralauncher.com");
    expect(openLinkMock).toHaveBeenNthCalledWith(
      2,
      "https://github.com/HellboundGlory/dayz-launcher",
    );
  });
});

describe("SECS", () => {
  it("ends with the About section", () => {
    expect(SECS.map((s) => s.id)).toEqual(["game", "launcher", "theme", "about"]);
    expect(SECS[3]).toMatchObject({ title: "About", description: "Version, updates, credits" });
  });
});
