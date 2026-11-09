import { afterEach, describe, expect, it } from "vitest";
import { useStartWindowStore } from "./start-window-store";

const token = { cancelled: false };

afterEach(() => {
  useStartWindowStore.getState().close();
});

describe("start window store", () => {
  it("keeps the step's start time while the step stays the same", () => {
    const store = useStartWindowStore.getState();
    store.show(token, false, false);
    store.noteStep(1, 1000);

    useStartWindowStore.getState().noteStep(1, 5000);

    expect(useStartWindowStore.getState().stepSince).toBe(1000);
  });

  it("restarts the step's start time when the step changes", () => {
    const store = useStartWindowStore.getState();
    store.show(token, false, false);
    store.noteStep(1, 1000);

    useStartWindowStore.getState().noteStep(2, 5000);

    expect(useStartWindowStore.getState().stepSince).toBe(5000);
    expect(useStartWindowStore.getState().stepIndex).toBe(2);
  });

  it("stays hidden across a resumed join after Hide, and shows again otherwise", () => {
    const store = useStartWindowStore.getState();
    store.show(token, false, false);
    store.hide();

    store.show({ cancelled: false }, false, true);
    expect(useStartWindowStore.getState().hidden).toBe(true);

    store.show({ cancelled: false }, false, false);
    expect(useStartWindowStore.getState().hidden).toBe(false);
  });

  it("restarts only the slow count, not the step's clock, when the download note moves", () => {
    const store = useStartWindowStore.getState();
    store.show(token, false, false);
    store.noteStep(1, 1000, "2 LEFT · 100 MB / 400 MB");

    useStartWindowStore.getState().noteStep(1, 5000, "2 LEFT · 100 MB / 400 MB");
    expect(useStartWindowStore.getState().stepSince).toBe(1000);

    useStartWindowStore.getState().noteStep(1, 9000, "1 LEFT · 200 MB / 400 MB");
    expect(useStartWindowStore.getState().slowSince).toBe(9000);
    expect(useStartWindowStore.getState().stepSince).toBe(1000);
  });

  it("clears the op on close", () => {
    const store = useStartWindowStore.getState();
    store.show(token, false, false);

    store.close();

    expect(useStartWindowStore.getState().forOp).toBeNull();
  });
});
