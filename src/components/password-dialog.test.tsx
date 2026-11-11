import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordDialog } from "./password-dialog";
import { usePasswordStore, type PasswordRequest } from "@/stores/password-store";
import { handleEscape, openEscapeLayer } from "@/theme/interaction/escape-layers";

// SSR takes zustand's initial-state snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/password-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/password-store")>();
  return { ...actual, usePasswordStore: liveHook(actual.usePasswordStore) };
});

// Effects never run under SSR, so record what the dialog hands the Escape layer.
const escapeLayer = vi.hoisted(() => ({
  active: null as boolean | null,
  close: null as (() => void) | null,
}));

vi.mock("@/theme/interaction/escape-layers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/theme/interaction/escape-layers")>();
  return {
    ...actual,
    useEscapeLayer: (active: boolean, close: () => void) => {
      escapeLayer.active = active;
      escapeLayer.close = close;
      return actual.useEscapeLayer(active, close);
    },
  };
});

// Captures props by data-part since renderToStaticMarkup drops event handlers.
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") captured[part] = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const request = { addr: "1.2.3.4:27016", serverName: "Test Server", keyring: true };

function ask(overrides: Partial<PasswordRequest> = {}) {
  return usePasswordStore.getState().ask({ ...request, ...overrides });
}

afterEach(() => {
  usePasswordStore.getState().cancel();
  for (const key of Object.keys(captured)) delete captured[key];
});

describe("PasswordDialog", () => {
  it("renders nothing until a join asks for a password", () => {
    expect(renderToStaticMarkup(<PasswordDialog />)).toBe("");
  });

  it("shows the server name, a masked field and the keyring note", () => {
    void ask();
    const html = renderToStaticMarkup(<PasswordDialog />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Server password");
    expect(html).toContain("Test Server");
    expect(captured["password"]?.type).toBe("password");
    expect(captured["remember"]?.disabled).toBe(false);
    expect(html).toContain("Saved in your system keyring, never in Tetra&#x27;s own files.");
  });

  it("greys out remembering when there is no keyring", () => {
    void ask({ keyring: false });
    const html = renderToStaticMarkup(<PasswordDialog />);

    expect(captured["remember"]?.disabled).toBe(true);
    expect(html).toContain("No system keyring found");
  });

  it("reveals the typed password once the eye is pressed", () => {
    void ask();
    usePasswordStore.getState().toggleReveal();
    renderToStaticMarkup(<PasswordDialog />);

    expect(captured["password"]?.type).toBe("text");
    expect(captured["reveal"]?.["aria-pressed"]).toBe(true);
  });

  it("submits on Enter", async () => {
    const pending = ask();
    usePasswordStore.getState().setDraft("pw");
    renderToStaticMarkup(<PasswordDialog />);

    const preventDefault = vi.fn();
    (captured["form"]?.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    await expect(pending).resolves.toEqual({ password: "pw", remember: true });
  });

  it("does not submit while the password is empty", async () => {
    let settled = false;
    void ask().then(() => {
      settled = true;
    });
    renderToStaticMarkup(<PasswordDialog />);

    const preventDefault = vi.fn();
    (captured["form"]?.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault });
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(usePasswordStore.getState().request).not.toBeNull();
  });

  it("cancels from the button", async () => {
    const pending = ask();
    renderToStaticMarkup(<PasswordDialog />);

    (captured["cancel"]?.onClick as () => void)();

    await expect(pending).resolves.toBeNull();
  });

  it("gives Escape the open request to close", async () => {
    const pending = ask();
    renderToStaticMarkup(<PasswordDialog />);

    expect(escapeLayer.active).toBe(true);
    const close = openEscapeLayer(escapeLayer.close!);
    handleEscape({ key: "Escape", preventDefault() {} });
    close();

    await expect(pending).resolves.toBeNull();
  });

  it("registers no Escape layer while nothing is asked", () => {
    renderToStaticMarkup(<PasswordDialog />);
    expect(escapeLayer.active).toBe(false);
  });
});
