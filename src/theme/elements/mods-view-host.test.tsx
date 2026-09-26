import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LayoutFile } from "../renderer/types";

const useModsLifecycle = vi.fn();
vi.mock("@/hooks/use-mods-lifecycle", () => ({ useModsLifecycle }));

const file: LayoutFile = {
  schemaVersion: 2,
  root: { type: "text", value: "Mods view marker" },
};

describe("ModsViewHost", () => {
  it("drives the mods lifecycle hook and renders the given layout file", async () => {
    const { ModsViewHost } = await import("./mods-view-host");
    useModsLifecycle.mockClear();

    const html = renderToStaticMarkup(<ModsViewHost file={file} themeId="builtin.tactical" />);

    expect(useModsLifecycle).toHaveBeenCalledTimes(1);
    expect(html).toContain("Mods view marker");
  });
});
