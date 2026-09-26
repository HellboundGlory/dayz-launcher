import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const getKnownMods = vi.fn();
const getWorkshopPreviews = vi.fn();
vi.mock("@/lib/tauri", async (orig) => ({
  ...(await orig<typeof import("@/lib/tauri")>()),
  getKnownMods: (...a: unknown[]) => getKnownMods(...a),
  getWorkshopPreviews: (...a: unknown[]) => getWorkshopPreviews(...a),
}));

import { useModFilterStore } from "@/stores/mod-filter-store";

describe("loadKnownMods previews", () => {
  beforeEach(() => {
    getKnownMods.mockReset();
    getWorkshopPreviews.mockReset();
    useModFilterStore.setState({ known: null, knownLoading: false });
  });

  it("fetches previews only for rows without a cached one and merges them in", async () => {
    getKnownMods.mockResolvedValue([
      { workshop_id: "1", name: "Cached", server_count: 2, preview_url: "https://x/1.png" },
      { workshop_id: "2", name: "Missing", server_count: 1, preview_url: null },
    ]);
    getWorkshopPreviews.mockResolvedValue({ "2": "https://x/2.png" });

    await useModFilterStore.getState().loadKnownMods();
    await vi.waitFor(() =>
      expect(useModFilterStore.getState().known?.[1].preview_url).toBe("https://x/2.png"),
    );
    expect(getWorkshopPreviews).toHaveBeenCalledWith(["2"]);
    expect(useModFilterStore.getState().known?.[0].preview_url).toBe("https://x/1.png");
  });

  it("skips the preview fetch when every row is cached", async () => {
    getKnownMods.mockResolvedValue([
      { workshop_id: "1", name: "Cached", server_count: 2, preview_url: "https://x/1.png" },
    ]);
    await useModFilterStore.getState().loadKnownMods();
    expect(getWorkshopPreviews).not.toHaveBeenCalled();
  });

  it("keeps the rows when the preview fetch fails", async () => {
    getKnownMods.mockResolvedValue([
      { workshop_id: "2", name: "Missing", server_count: 1, preview_url: null },
    ]);
    getWorkshopPreviews.mockRejectedValue(new Error("steam down"));
    await useModFilterStore.getState().loadKnownMods();
    await Promise.resolve();
    expect(useModFilterStore.getState().known).toEqual([
      { workshop_id: "2", name: "Missing", server_count: 1, preview_url: null },
    ]);
  });
});
