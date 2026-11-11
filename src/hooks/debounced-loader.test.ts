import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedLoader } from "./debounced-loader";

afterEach(() => {
  vi.useRealTimers();
});

describe("createDebouncedLoader", () => {
  it("drops a reply older than the newest request", async () => {
    vi.useFakeTimers();
    const pending: ((list: string) => void)[] = [];
    const answers: string[] = [];
    const loader = createDebouncedLoader(
      (list: string) => answers.push(list),
      () => answers.push("failed"),
    );

    loader.request(true, () => new Promise<string>((resolve) => pending.push(resolve)));
    loader.request(false, () => new Promise<string>((resolve) => pending.push(resolve)));
    await vi.advanceTimersByTimeAsync(250);
    expect(pending).toHaveLength(2);

    pending[0]?.("nam");
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual([]);

    pending[1]?.("nama");
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual(["nama"]);
  });
});
