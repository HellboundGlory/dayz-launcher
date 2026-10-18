import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { useUpdateStore } from "@/stores/update-store";
import {
  UpdateChangelog,
  UpdateInstall,
  UpdateLater,
  UpdatePortableNote,
  UpdateProgress,
  UpdateSummary,
  UpdateTitle,
  UpdateViewRelease,
} from "./update-elements";

const openLinkMock = vi.fn();
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => openLinkMock(...args),
}));

// SSR takes zustand's initial-state snapshot, so route the hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/update-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/update-store")>();
  return { ...actual, useUpdateStore: liveHook(actual.useUpdateStore) };
});

let capturedClickHandlers: Record<string, (e: { stopPropagation: () => void }) => void> = {};

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const el = props["data-el"] as string | undefined;
      if (el && typeof props.onClick === "function") {
        capturedClickHandlers[el] = props.onClick as (e: { stopPropagation: () => void }) => void;
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

beforeEach(() => {
  capturedClickHandlers = {};
});

function withUpdateStore<T>(overrides: Record<string, unknown>, fn: () => T): T {
  const prior = useUpdateStore.getState();
  useUpdateStore.setState({ ...prior, ...overrides });
  try {
    return fn();
  } finally {
    useUpdateStore.setState(prior, true);
  }
}

const click = (el: string) => capturedClickHandlers[el]?.({ stopPropagation: vi.fn() });

describe("UpdateInstall", () => {
  it("renders only for an installed copy", () => {
    const html = withUpdateStore({ installed: false }, () => renderToStaticMarkup(<UpdateInstall />));
    expect(html).toBe("");
  });

  it("reads Update & Restart and calls install when clicked", () => {
    const install = vi.fn();
    const html = withUpdateStore({ installed: true, install }, () =>
      renderToStaticMarkup(<UpdateInstall />),
    );
    expect(html).toContain("Update &amp; Restart");
    click("update.install");
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("is busy and disabled while installing", () => {
    const html = withUpdateStore({ installed: true, installing: true }, () =>
      renderToStaticMarkup(<UpdateInstall />),
    );
    expect(html).toContain('data-state="busy disabled"');
    expect(html).toContain("disabled=\"\"");
  });
});

describe("UpdateViewRelease", () => {
  it("renders only for a portable copy", () => {
    const html = withUpdateStore({ installed: true }, () => renderToStaticMarkup(<UpdateViewRelease />));
    expect(html).toBe("");
  });

  it("opens the download URL when clicked", () => {
    withUpdateStore({ installed: false }, () => renderToStaticMarkup(<UpdateViewRelease />));
    click("update.viewRelease");
    expect(openLinkMock).toHaveBeenCalledWith("https://tetralauncher.com/download");
  });
});

describe("UpdateLater", () => {
  it("closes the modal when clicked", () => {
    const closeModal = vi.fn();
    withUpdateStore({ installing: false }, () =>
      renderToStaticMarkup(
        <ElementContextProvider value={{ closeModal }}>
          <UpdateLater />
        </ElementContextProvider>,
      ),
    );
    click("update.later");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it("reads Updating… and is disabled while installing", () => {
    const html = withUpdateStore({ installing: true }, () => renderToStaticMarkup(<UpdateLater />));
    expect(html).toContain("Updating…");
    expect(html).toContain('data-state="disabled"');
  });

  it("honours the label option when not installing", () => {
    const html = withUpdateStore({ installing: false }, () =>
      renderToStaticMarkup(<UpdateLater options={{ label: "Not now" }} />),
    );
    expect(html).toContain("Not now");
  });
});

describe("UpdateTitle", () => {
  it("reads Updates, or Update available when a release is available", () => {
    const none = withUpdateStore({ available: null }, () => renderToStaticMarkup(<UpdateTitle />));
    expect(none).toContain("Updates");

    const available = withUpdateStore({ available: { version: "1.2.3", date: null, body: null } }, () =>
      renderToStaticMarkup(<UpdateTitle />),
    );
    expect(available).toContain("Update available");
  });
});

describe("UpdateSummary", () => {
  it("states upToDate with no update, and available with version and date", () => {
    const upToDate = withUpdateStore({ available: null }, () => renderToStaticMarkup(<UpdateSummary />));
    expect(upToDate).toContain('data-state="upToDate"');

    const available = withUpdateStore(
      { available: { version: "1.2.3", date: "2026-01-01", body: null } },
      () => renderToStaticMarkup(<UpdateSummary />),
    );
    expect(available).toContain('data-state="available"');
    expect(available).toContain("v1.2.3");
    expect(available).toContain("2026-01-01");
  });
});

describe("UpdateChangelog", () => {
  it("renders nothing when up to date, the notes when an update has them, and the empty wording when it has none", () => {
    const upToDate = withUpdateStore({ available: null, changelog: null }, () =>
      renderToStaticMarkup(<UpdateChangelog />),
    );
    expect(upToDate).toBe("");

    const released = withUpdateStore(
      { available: { version: "1.2.3", date: null, body: "**hello**" } },
      () => renderToStaticMarkup(<UpdateChangelog />),
    );
    expect(released).toContain("hello");
    expect(released).not.toContain("No changelog notes");

    const noNotes = withUpdateStore({ available: { version: "1.2.3", date: null, body: null }, changelog: null }, () =>
      renderToStaticMarkup(<UpdateChangelog />),
    );
    expect(noNotes).toContain('data-state="empty"');
    expect(noNotes).toContain("No changelog notes for this release.");
  });
});

describe("UpdateProgress", () => {
  it("renders nothing when idle with no error", () => {
    const html = withUpdateStore({ installing: false, progress: null, error: null }, () =>
      renderToStaticMarkup(<UpdateProgress />),
    );
    expect(html).toBe("");
  });

  it("shows the downloading percentage", () => {
    const html = withUpdateStore(
      { installing: true, progress: { downloaded: 50, total: 100 }, error: null },
      () => renderToStaticMarkup(<UpdateProgress />),
    );
    expect(html).toContain('data-state="downloading"');
    expect(html).toContain("Downloading… 50%");
  });

  it("shows the error state", () => {
    const html = withUpdateStore(
      { installing: false, progress: null, error: "network error" },
      () => renderToStaticMarkup(<UpdateProgress />),
    );
    expect(html).toContain('data-state="failed"');
    expect(html).toContain("network error");
  });
});

describe("UpdatePortableNote", () => {
  it.each([
    { name: "renders nothing for an installed copy", overrides: { installed: true }, text: null },
    { name: "renders nothing without an available update", overrides: { installed: false, available: null }, text: null },
    {
      name: "renders the note for a portable copy with an update",
      overrides: { installed: false, available: { version: "1.2.3" } },
      text: "portable copy",
    },
  ])("$name", ({ overrides, text }) => {
    const html = withUpdateStore(overrides, () => renderToStaticMarkup(<UpdatePortableNote />));
    if (text === null) expect(html).toBe("");
    else expect(html).toContain(text);
  });
});
