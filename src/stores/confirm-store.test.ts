import { afterEach, describe, expect, it, vi } from "vitest";
import { useConfirmStore } from "./confirm-store";

afterEach(() => {
  useConfirmStore.setState({ request: null });
});

describe("confirm store", () => {
  it("keeps a request's rows and negative-danger flag", () => {
    useConfirmStore
      .getState()
      .ask("Different game version", "They differ.", () => {}, "Join anyway", {
        rows: [
          ["Server", "1.28.161464"],
          ["Yours", "1.29.163709"],
        ],
        destructive: false,
      });

    const request = useConfirmStore.getState().request;
    expect(request?.rows).toEqual([
      ["Server", "1.28.161464"],
      ["Yours", "1.29.163709"],
    ]);
    expect(request?.destructive).toBe(false);
  });

  it("defaults a request to destructive without rows", () => {
    useConfirmStore.getState().ask("Delete it", "Are you sure?", () => {});

    const request = useConfirmStore.getState().request;
    expect(request?.destructive).toBe(true);
    expect(request?.rows).toBeUndefined();
  });

  it("runs onCancel on a cancel and not on a confirm", () => {
    const action = vi.fn();
    const onCancel = vi.fn();
    useConfirmStore
      .getState()
      .ask("Delete it", "Are you sure?", action, "Delete", { onCancel });

    useConfirmStore.getState().resolve(true);

    expect(action).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("runs onCancel when resolved false and leaves the action alone", () => {
    const action = vi.fn();
    const onCancel = vi.fn();
    useConfirmStore
      .getState()
      .ask("Delete it", "Are you sure?", action, "Delete", { onCancel });

    useConfirmStore.getState().resolve(false);

    expect(action).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels an open request before showing a replacing one", () => {
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();
    useConfirmStore
      .getState()
      .ask("First", "The first.", () => {}, "OK", { onCancel: firstCancel });
    useConfirmStore
      .getState()
      .ask("Second", "The second.", () => {}, "OK", { onCancel: secondCancel });

    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(secondCancel).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().request?.title).toBe("Second");
  });

  it("runs the alternate action without the confirm action", () => {
    const action = vi.fn();
    const onAlt = vi.fn();
    useConfirmStore
      .getState()
      .ask("Mod differs", "It differs.", action, "Fix and join", { onAlt });

    useConfirmStore.getState().resolveAlt();

    expect(onAlt).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().request).toBeNull();
  });
});
