import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";

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
  openLinkMock.mockReset();
});

async function withUpdateStore<T>(overrides: Record<string, unknown>, fn: () => T): Promise<T> {
  const { useUpdateStore } = await import("@/stores/update-store");
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
  it("renders only for an installed copy", async () => {
    const { UpdateInstall } = await import("./update-elements");
    const html = await withUpdateStore({ installed: false }, () =>
      renderToStaticMarkup(<UpdateInstall />),
    );
    expect(html).toBe("");
  });

  it("reads Update & Restart and calls install when clicked", async () => {
    const { UpdateInstall } = await import("./update-elements");
    const install = vi.fn();
    const html = await withUpdateStore({ installed: true, install }, () =>
      renderToStaticMarkup(<UpdateInstall />),
    );
    expect(html).toContain("Update &amp; Restart");
    click("update.install");
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("is busy and disabled while installing", async () => {
    const { UpdateInstall } = await import("./update-elements");
    const html = await withUpdateStore({ installed: true, installing: true }, () =>
      renderToStaticMarkup(<UpdateInstall />),
    );
    expect(html).toContain('data-state="busy disabled"');
    expect(html).toContain("disabled=\"\"");
  });
});

describe("UpdateViewRelease", () => {
  it("renders only for a portable copy", async () => {
    const { UpdateViewRelease } = await import("./update-elements");
    const html = await withUpdateStore({ installed: true }, () =>
      renderToStaticMarkup(<UpdateViewRelease />),
    );
    expect(html).toBe("");
  });

  it("reads View Release and opens the download URL", async () => {
    const { UpdateViewRelease } = await import("./update-elements");
    const html = await withUpdateStore({ installed: false }, () =>
      renderToStaticMarkup(<UpdateViewRelease />),
    );
    expect(html).toContain("View Release");
    click("update.viewRelease");
    expect(openLinkMock).toHaveBeenCalledWith("https://tetralauncher.com/download");
  });
});

describe("UpdateLater", () => {
  it("reads Later and closes the modal when clicked", async () => {
    const { UpdateLater } = await import("./update-elements");
    const closeModal = vi.fn();
    const html = await withUpdateStore({ installing: false }, () =>
      renderToStaticMarkup(
        <ElementContextProvider value={{ closeModal }}>
          <UpdateLater />
        </ElementContextProvider>,
      ),
    );
    expect(html).toContain("Later");
    click("update.later");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it("reads Updating… and is disabled while installing", async () => {
    const { UpdateLater } = await import("./update-elements");
    const html = await withUpdateStore({ installing: true }, () =>
      renderToStaticMarkup(<UpdateLater />),
    );
    expect(html).toContain("Updating…");
    expect(html).toContain('data-state="disabled"');
  });

  it("honours the label option when not installing", async () => {
    const { UpdateLater } = await import("./update-elements");
    const html = await withUpdateStore({ installing: false }, () =>
      renderToStaticMarkup(<UpdateLater options={{ label: "Not now" }} />),
    );
    expect(html).toContain("Not now");
  });
});

describe("UpdateTitle", () => {
  it("reads Updates when nothing is available", async () => {
    const { UpdateTitle } = await import("./update-elements");
    const html = await withUpdateStore({ available: null }, () =>
      renderToStaticMarkup(<UpdateTitle />),
    );
    expect(html).toContain("Updates");
  });

  it("reads Update available when a release is available", async () => {
    const { UpdateTitle } = await import("./update-elements");
    const html = await withUpdateStore(
      { available: { version: "1.2.3", date: null, body: null } },
      () => renderToStaticMarkup(<UpdateTitle />),
    );
    expect(html).toContain("Update available");
  });
});

describe("UpdateSummary", () => {
  it("states upToDate with no available update", async () => {
    const { UpdateSummary } = await import("./update-elements");
    const html = await withUpdateStore({ available: null }, () =>
      renderToStaticMarkup(<UpdateSummary />),
    );
    expect(html).toContain('data-state="upToDate"');
    expect(html).toContain("You&#x27;re up to date.");
  });

  it("states available with version and date", async () => {
    const { UpdateSummary } = await import("./update-elements");
    const html = await withUpdateStore(
      { available: { version: "1.2.3", date: "2026-01-01", body: null } },
      () => renderToStaticMarkup(<UpdateSummary />),
    );
    expect(html).toContain('data-state="available"');
    expect(html).toContain("v1.2.3");
    expect(html).toContain("2026-01-01");
  });
});

describe("UpdateChangelog", () => {
  it("states empty with the legacy wording when there is no content", async () => {
    const { UpdateChangelog } = await import("./update-elements");
    const html = await withUpdateStore({ available: null, changelog: null }, () =>
      renderToStaticMarkup(<UpdateChangelog />),
    );
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No changelog notes for this release.");
  });

  it("renders changelog markdown content", async () => {
    const { UpdateChangelog } = await import("./update-elements");
    const html = await withUpdateStore(
      { available: { version: "1.2.3", date: null, body: "**hello**" } },
      () => renderToStaticMarkup(<UpdateChangelog />),
    );
    expect(html).toContain("hello");
    expect(html).not.toContain("No changelog notes");
  });
});

describe("UpdateProgress", () => {
  it("renders nothing when idle with no error", async () => {
    const { UpdateProgress } = await import("./update-elements");
    const html = await withUpdateStore({ installing: false, progress: null, error: null }, () =>
      renderToStaticMarkup(<UpdateProgress />),
    );
    expect(html).toBe("");
  });

  it("shows the downloading percentage", async () => {
    const { UpdateProgress } = await import("./update-elements");
    const html = await withUpdateStore(
      { installing: true, progress: { downloaded: 50, total: 100 }, error: null },
      () => renderToStaticMarkup(<UpdateProgress />),
    );
    expect(html).toContain('data-state="downloading"');
    expect(html).toContain("Downloading… 50%");
  });

  it("shows the error state", async () => {
    const { UpdateProgress } = await import("./update-elements");
    const html = await withUpdateStore(
      { installing: false, progress: null, error: "network error" },
      () => renderToStaticMarkup(<UpdateProgress />),
    );
    expect(html).toContain('data-state="failed"');
    expect(html).toContain("network error");
  });
});

describe("UpdatePortableNote", () => {
  it("renders only for a portable copy", async () => {
    const { UpdatePortableNote } = await import("./update-elements");
    const html = await withUpdateStore({ installed: true }, () =>
      renderToStaticMarkup(<UpdatePortableNote />),
    );
    expect(html).toBe("");
  });

  it("reads the legacy portable note text", async () => {
    const { UpdatePortableNote } = await import("./update-elements");
    const html = await withUpdateStore({ installed: false }, () =>
      renderToStaticMarkup(<UpdatePortableNote />),
    );
    expect(html).toContain("portable copy");
  });
});
