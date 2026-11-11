import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// SSR takes zustand's initial-state snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/confirm-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/confirm-store")>();
  return { ...actual, useConfirmStore: liveHook(actual.useConfirmStore) };
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

afterEach(async () => {
  const { useConfirmStore } = await import("@/stores/confirm-store");
  useConfirmStore.setState({ request: null });
  for (const key of Object.keys(captured)) delete captured[key];
});

describe("ConfirmDialog", () => {
  it("renders nothing until something asks for confirmation", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const html = renderToStaticMarkup(<ConfirmDialog />);
    expect(html).toBe("");
  });

  it("renders the title and message once asked", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    useConfirmStore.getState().ask("Delete it", "Are you sure?", () => {});
    const html = renderToStaticMarkup(<ConfirmDialog />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-part="title"');
    expect(html).toContain("Delete it");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Are you sure?");
  });

  it("runs the action only when resolved with confirm", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const action = vi.fn();
    useConfirmStore.getState().ask("Delete it", "Are you sure?", action);
    renderToStaticMarkup(<ConfirmDialog />);

    const confirmClick = captured["confirm"]?.onClick as () => void;
    confirmClick();

    expect(action).toHaveBeenCalledTimes(1);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it("does not run the action when resolved with cancel", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const action = vi.fn();
    useConfirmStore.getState().ask("Delete it", "Are you sure?", action);
    renderToStaticMarkup(<ConfirmDialog />);

    const cancelClick = captured["cancel"]?.onClick as () => void;
    cancelClick();

    expect(action).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it("renders the request's rows under the message", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    useConfirmStore
      .getState()
      .ask("Different game version", "They differ.", () => {}, "Join anyway", {
        rows: [
          ["Server", "1.28.161464"],
          ["Yours", "1.29.163709"],
        ],
      });

    const html = renderToStaticMarkup(<ConfirmDialog />);

    expect(html).toContain('data-part="rows"');
    expect(html).toContain('data-part="row-label"');
    expect(html).toContain('data-part="row-value"');
    expect(html).toContain("Server");
    expect(html).toContain("1.28.161464");
    expect(html).toContain("Yours");
    expect(html).toContain("1.29.163709");
  });

  it("puts a warning message in a warning box with a triangle", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    useConfirmStore.getState().ask("Different game version", "They differ.", () => {}, "Join anyway", {
      warning: true,
    });

    const html = renderToStaticMarkup(<ConfirmDialog />);

    expect(html).toMatch(/data-part="warning"[^>]*>.*data-part="icon".*They differ\./s);
  });

  it("runs onCancel from a cancel and not from a confirm", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const onCancel = vi.fn();
    useConfirmStore
      .getState()
      .ask("Delete it", "Are you sure?", () => {}, "Delete", { onCancel });
    renderToStaticMarkup(<ConfirmDialog />);

    (captured["cancel"]?.onClick as () => void)();
    expect(onCancel).toHaveBeenCalledTimes(1);

    useConfirmStore
      .getState()
      .ask("Delete it", "Are you sure?", () => {}, "Delete", { onCancel });
    renderToStaticMarkup(<ConfirmDialog />);
    (captured["confirm"]?.onClick as () => void)();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("draws a non-destructive confirm like Cancel", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");

    useConfirmStore.getState().ask("Different game version", "They differ.", () => {}, "Join anyway", {
      destructive: false,
    });
    const plain = renderToStaticMarkup(<ConfirmDialog />);
    expect(plain).not.toContain("bg-danger");

    useConfirmStore.getState().ask("Delete it", "Are you sure?", () => {});
    const dangerous = renderToStaticMarkup(<ConfirmDialog />);
    expect(dangerous).toContain("bg-danger");
  });
});
