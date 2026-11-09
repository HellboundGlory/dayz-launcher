import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Server } from "@/types/server";
import { ElementContextProvider } from "./context";

const useInstalledDayzVersion = vi.fn<() => string | null>(() => null);

vi.mock("@/hooks/use-filter-facets", () => ({ useInstalledDayzVersion }));

const server = {
  addr: "46.7.13.31",
  query_port: 2303,
  name: "Some Server",
  version: "1.28.161464",
} as Server;

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ subjectContext: { kind: "server", data: server }, contextName: "row" }}>
      {node}
    </ElementContextProvider>,
  );
}

describe("ServerVersionWarning", () => {
  it("says nothing when the builds match", async () => {
    useInstalledDayzVersion.mockReturnValue("1.28.161464");
    const { ServerVersionWarning } = await import("./version-warning");

    expect(render(<ServerVersionWarning />)).toBe("");
  });

  it("says nothing when the installed version is unknown", async () => {
    useInstalledDayzVersion.mockReturnValue(null);
    const { ServerVersionWarning } = await import("./version-warning");

    expect(render(<ServerVersionWarning />)).toBe("");
  });

  it("names both versions on a mismatch", async () => {
    useInstalledDayzVersion.mockReturnValue("1.29.163709");
    const { ServerVersionWarning } = await import("./version-warning");

    const html = render(<ServerVersionWarning />);

    expect(html).toContain('data-el="server.versionWarning"');
    expect(html).toContain('role="img"');
    expect(html).toContain('title="Server runs 1.28.161464, you have 1.29.163709"');
    expect(html).toContain('aria-label="Server runs 1.28.161464, you have 1.29.163709"');
    expect(html).toContain('data-part="icon"');
    expect(html).not.toContain("--t-color-warn");
    expect(html).toContain("text-warn");
  });
});
