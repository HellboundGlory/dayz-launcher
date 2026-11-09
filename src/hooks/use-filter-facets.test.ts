import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilterFacets } from "@/lib/tauri";
import type { ServerFilter } from "@/types/filters";
import { DEFAULT_FILTER } from "@/stores/server-store";
import { createFacetLoader, type FacetResult } from "./use-filter-facets";

const facets = (total: number): FilterFacets => ({
  total,
  maps: [],
  versions: [],
  countries: [],
  mods: [],
  same_as_mine: null,
});

function harness() {
  const answers: FacetResult[] = [];
  const fetcher = vi.fn(() => Promise.resolve(facets(1)));
  const loader = createFacetLoader(fetcher, (found) => answers.push(found));
  return { answers, fetcher, loader };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createFacetLoader", () => {
  it("asks once on open and once more after the filter settles", async () => {
    vi.useFakeTimers();
    const { fetcher, loader, answers } = harness();
    const filter = { ...DEFAULT_FILTER };

    loader.update(true, filter, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const changed = { ...filter, max_ping: 100 };
    loader.update(true, changed, null);
    loader.update(true, { ...changed, max_ping: 50 }, null);
    loader.update(true, { ...changed, max_ping: 150 }, null);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(answers).toHaveLength(2);
  });

  it("asks nothing while closed", async () => {
    vi.useFakeTimers();
    const { fetcher, loader } = harness();
    loader.update(false, { ...DEFAULT_FILTER }, null);
    loader.update(false, { ...DEFAULT_FILTER, hide_full: true }, null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("waits until the filter has been still for 250 ms and asks with the last one", async () => {
    vi.useFakeTimers();
    const { fetcher, loader } = harness();
    loader.update(true, { ...DEFAULT_FILTER }, null);
    for (const max_ping of [50, 100, 150]) {
      loader.update(true, { ...DEFAULT_FILTER, max_ping }, null);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith({ ...DEFAULT_FILTER, max_ping: 150 }, null);
  });

  it("drops a reply older than the newest request", async () => {
    vi.useFakeTimers();
    const pending: ((found: FilterFacets) => void)[] = [];
    const onResult = vi.fn();
    const loader = createFacetLoader(
      () => new Promise<FilterFacets>((resolve) => pending.push(resolve)),
      onResult,
    );
    const filter: ServerFilter = { ...DEFAULT_FILTER };

    loader.update(true, filter, null);
    loader.update(true, { ...filter, max_ping: 100 }, null);
    await vi.advanceTimersByTimeAsync(250);
    expect(pending).toHaveLength(2);

    pending[0]?.(facets(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).not.toHaveBeenCalled();

    pending[1]?.(facets(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith({ facets: facets(2), failed: false });
  });

  it("clears the counts when the menu closes", () => {
    const { loader, answers } = harness();
    loader.update(true, { ...DEFAULT_FILTER }, null);
    loader.update(false, { ...DEFAULT_FILTER }, null);
    expect(answers[answers.length - 1]).toEqual({ facets: null, failed: false });
  });

  it("marks a failed request and keeps no counts with it", async () => {
    const onResult = vi.fn();
    const loader = createFacetLoader(() => Promise.reject(new Error("no reader")), onResult);
    loader.update(true, { ...DEFAULT_FILTER }, null);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith({ facets: null, failed: true }));
  });

  it("drops an in-flight reply once stopped, and asks nothing more", async () => {
    vi.useFakeTimers();
    const pending: ((found: FilterFacets) => void)[] = [];
    const onResult = vi.fn();
    const loader = createFacetLoader(
      () => new Promise<FilterFacets>((resolve) => pending.push(resolve)),
      onResult,
    );
    const filter = { ...DEFAULT_FILTER };

    loader.update(true, filter, null);
    loader.update(true, { ...filter, max_ping: 100 }, null);
    loader.stop();

    pending[0]?.(facets(1));
    await vi.advanceTimersByTimeAsync(300);
    expect(pending).toHaveLength(1);
    expect(onResult).not.toHaveBeenCalled();
  });
});
