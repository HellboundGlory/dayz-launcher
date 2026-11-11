import { afterEach, describe, expect, it } from "vitest";
import { useMemoryMapStore } from "./memory-map-store";

const status = { current: 65530, recommended: 1048576 };

afterEach(() => {
  useMemoryMapStore.getState().answer(false, false);
  useMemoryMapStore.setState({ request: null });
});

describe("memory map store", () => {
  it("stores the request and resolves it with the answer", async () => {
    const answer = useMemoryMapStore.getState().ask(status);
    expect(useMemoryMapStore.getState().request).toEqual({ status });

    useMemoryMapStore.getState().answer(true, false);
    await expect(answer).resolves.toEqual({ join: true, dontWarn: false });
    expect(useMemoryMapStore.getState().request).toBeNull();
  });

  it("resolves an older request as a cancel when a second one arrives", async () => {
    const first = useMemoryMapStore.getState().ask(status);
    const second = useMemoryMapStore.getState().ask({ current: 1000, recommended: 1048576 });

    await expect(first).resolves.toEqual({ join: false, dontWarn: false });
    expect(useMemoryMapStore.getState().request).toEqual({
      status: { current: 1000, recommended: 1048576 },
    });

    useMemoryMapStore.getState().answer(true, true);
    await expect(second).resolves.toEqual({ join: true, dontWarn: true });
  });
});
