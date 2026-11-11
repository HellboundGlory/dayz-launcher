import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchSuggestion } from "@/lib/tauri";
import type { ServerFilter } from "@/types/filters";
import { DEFAULT_FILTER } from "@/stores/server-store";
import { createSuggestionLoader, listForText } from "./use-search-suggestions";

const found = (label: string): SearchSuggestion[] => [
  { kind: "map", label, count: 3, values: [label.toLowerCase()] },
];

function harness() {
  const answers: (SearchSuggestion[] | null)[] = [];
  const fetcher = vi.fn((_filter: ServerFilter, text: string) => Promise.resolve(found(text)));
  const loader = createSuggestionLoader(fetcher, (result) => answers.push(result?.list ?? null));
  return { answers, fetcher, loader };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createSuggestionLoader", () => {
  it("asks nothing under two characters", async () => {
    vi.useFakeTimers();
    const { fetcher, loader } = harness();
    loader.update(true, true, { ...DEFAULT_FILTER }, "n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks nothing while the box is not focused or the tab is not All servers", async () => {
    vi.useFakeTimers();
    const { fetcher, loader } = harness();
    loader.update(false, true, { ...DEFAULT_FILTER }, "namalsk");
    loader.update(true, false, { ...DEFAULT_FILTER }, "namalsk");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("makes one call for three changes inside the debounce", async () => {
    vi.useFakeTimers();
    const { fetcher, loader, answers } = harness();
    for (const text of ["na", "nam", "nama"]) {
      loader.update(true, true, { ...DEFAULT_FILTER }, text);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenLastCalledWith({ ...DEFAULT_FILTER }, "nama");
    expect(answers).toHaveLength(1);
  });

  it("gives no list on an error", async () => {
    vi.useFakeTimers();
    const answers: (SearchSuggestion[] | null)[] = [];
    const loader = createSuggestionLoader(() => Promise.reject(new Error("no")), (result) => answers.push(result?.list ?? null));
    loader.update(true, true, { ...DEFAULT_FILTER }, "nam");
    await vi.advanceTimersByTimeAsync(250);
    expect(answers).toEqual([null]);
  });

  it("waits the debounce on the first ask too", async () => {
    vi.useFakeTimers();
    const { fetcher, loader } = harness();
    loader.update(true, true, { ...DEFAULT_FILTER }, "namalsk");
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenLastCalledWith({ ...DEFAULT_FILTER }, "namalsk");
  });

  it("clears the list when the box loses focus", async () => {
    vi.useFakeTimers();
    const { loader, answers } = harness();
    loader.update(true, true, { ...DEFAULT_FILTER }, "namalsk");
    await vi.advanceTimersByTimeAsync(250);
    expect(answers).toEqual([found("namalsk")]);

    loader.update(false, true, { ...DEFAULT_FILTER }, "namalsk");
    expect(answers[answers.length - 1]).toBeNull();
  });

  it("trims the text before deciding whether to ask", async () => {
    vi.useFakeTimers();
    const { fetcher, loader } = harness();
    loader.update(true, true, { ...DEFAULT_FILTER }, "  n  ");
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).not.toHaveBeenCalled();

    loader.update(true, true, { ...DEFAULT_FILTER }, "  nam  ");
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenLastCalledWith({ ...DEFAULT_FILTER }, "nam");
  });

  it("drops a pending ask once the text falls under two characters", async () => {
    vi.useFakeTimers();
    const { fetcher, loader } = harness();
    loader.update(true, true, { ...DEFAULT_FILTER }, "na");
    loader.update(true, true, { ...DEFAULT_FILTER }, "n");
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("listForText", () => {
  it("shows a list only while it answers the text in the box", () => {
    const result = { query: "nam", list: found("Namalsk") };
    expect(listForText(" nam ", result)).toEqual(found("Namalsk"));
    expect(listForText("nama", result)).toBeNull();
    expect(listForText("nam", null)).toBeNull();
  });
});
