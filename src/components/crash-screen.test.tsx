import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CrashBoundary,
  CrashScreen,
  bugReportUrl,
  formatCrashDetails,
  installCrashLogging,
} from "./crash-screen";

vi.mock("@/lib/tauri", () => ({
  logClient: vi.fn(() => Promise.resolve()),
  openDataFolder: vi.fn(() => Promise.resolve()),
}));

describe("formatCrashDetails", () => {
  it("keeps the error, its stack and the component stack", () => {
    const error = new Error("Cannot read properties of undefined (reading 'mods')");
    error.stack = "Error: mods\n    at ServerModsList (server-mods-list.tsx:88)";

    const details = formatCrashDetails(error, "\n    at ServerInfo (server-info.tsx:41)");

    expect(details).toContain("Error: Cannot read properties of undefined (reading 'mods')");
    expect(details).toContain("at ServerModsList (server-mods-list.tsx:88)");
    expect(details).toContain("at ServerInfo (server-info.tsx:41)");
  });

  it("stringifies a thrown value that is not an Error", () => {
    expect(formatCrashDetails("steam refused")).toBe("steam refused");
  });

  it("caps the details at 8,000 characters", () => {
    expect(formatCrashDetails(new Error("x".repeat(9000)))).toHaveLength(8000);
  });
});

describe("bugReportUrl", () => {
  const base = "https://github.com/HellboundGlory/dayz-launcher/issues/new";
  const onlyTemplate = `${base}?template=bug_report.yml`;
  it.each<[string | undefined, string]>([
    ["3.1.1", `${onlyTemplate}&version=3.1.1`],
    [undefined, onlyTemplate],
    ["", onlyTemplate],
    ["  ", onlyTemplate],
    ["3.1.1 beta&x=1", `${onlyTemplate}&version=3.1.1+beta%26x%3D1`],
  ])("builds the bug form link for %j", (version, expected) => {
    expect(bugReportUrl(version)).toBe(expected);
  });
});

describe("CrashBoundary", () => {
  it("holds the details of whatever a child threw", () => {
    const state = CrashBoundary.getDerivedStateFromError(
      new TypeError("undefined is not an object"),
    );
    expect(state.details).toContain("TypeError: undefined is not an object");
  });
});

describe("CrashScreen", () => {
  const html = renderToStaticMarkup(<CrashScreen details="TypeError: mods" />);

  it("says what happened, in the alert role", () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain(
      "Tetra hit an error it couldn&#x27;t recover from. Your favourites and settings are safe. The details below are already in the log.",
    );
    expect(html).toContain("TypeError: mods");
  });

  it("offers Reload, Copy details and Open log folder", () => {
    for (const label of ["Reload", "Copy details", "Open log folder"]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("puts the window controls in a draggable strip", () => {
    expect(html).toContain('data-part="titlebar"');
    expect(html).toContain('data-tauri-drag-region="deep"');
    expect(html).toContain("Tetra Launcher · crashed");
    for (const label of ["Minimise", "Maximise", "Close"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("offers Report on GitHub with the paste hint", () => {
    expect(html).toContain(">Report on GitHub<");
    expect(html).toContain(
      "To report it, copy the details, then press Report on GitHub and paste them into the form.",
    );
  });

  it("announces the message, not the window controls", () => {
    const alert = html.slice(html.indexOf('role="alert"'));
    expect(alert).not.toContain('aria-label="Close"');
  });
});

function fakeTarget() {
  const listeners = new Map<string, (event: Event) => void>();
  return {
    listeners,
    target: {
      addEventListener: (type: string, listener: (event: Event) => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    },
  };
}

describe("installCrashLogging", () => {
  it("logs an unhandled rejection once, then stops on removal", () => {
    const { listeners, target } = fakeTarget();
    const log = vi.fn<(level: string, message: string) => void>();
    const stop = installCrashLogging(target, log);

    listeners.get("unhandledrejection")!(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("probe failed") }),
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe("crash");
    expect(log.mock.calls[0][1]).toContain("probe failed");

    stop();
    expect(listeners.size).toBe(0);
  });

  it("logs an uncaught error with its source and line", () => {
    const { listeners, target } = fakeTarget();
    const log = vi.fn<(level: string, message: string) => void>();
    installCrashLogging(target, log);

    listeners.get("error")!(
      Object.assign(new Event("error"), {
        message: "boom",
        filename: "app.js",
        lineno: 42,
      }),
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toContain("boom");
    expect(log.mock.calls[0][1]).toContain("app.js:42");
  });

  it("stops logging an error loop after 20 lines, saying so once", () => {
    const { listeners, target } = fakeTarget();
    const log = vi.fn<(level: string, message: string) => void>();
    installCrashLogging(target, log);

    for (let i = 0; i < 50; i++) {
      listeners.get("error")!(Object.assign(new Event("error"), { message: `boom ${i}` }));
    }

    expect(log).toHaveBeenCalledTimes(21);
    expect(log.mock.calls[20][1]).toMatch(/not logged/);
  });

  it("ignores the browser's ResizeObserver loop notice", () => {
    const { listeners, target } = fakeTarget();
    const log = vi.fn<(level: string, message: string) => void>();
    installCrashLogging(target, log);

    listeners.get("error")!(
      Object.assign(new Event("error"), {
        message: "ResizeObserver loop completed with undelivered notifications.",
      }),
    );

    expect(log).not.toHaveBeenCalled();
  });
});
