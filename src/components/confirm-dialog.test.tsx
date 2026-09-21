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

  it("closes without running the action on Escape (same resolve(false) path the key handler calls)", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const action = vi.fn();
    useConfirmStore.getState().ask("Delete it", "Are you sure?", action);
    renderToStaticMarkup(<ConfirmDialog />);

    useConfirmStore.getState().resolve(false);

    expect(action).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().request).toBeNull();
  });
});
