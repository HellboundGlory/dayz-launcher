import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { ModReadinessEntry, Server } from "@/types/server";
import { ElementContextProvider, type ElementContextValue } from "./context";
import { setCachedReadiness } from "@/stores/readiness-store";

const { verifyAndJoin, reinstallSubscribedMod, steamModStates, invalidateReadiness } = vi.hoisted(
  () => ({
    verifyAndJoin: vi.fn(() => Promise.resolve()),
    reinstallSubscribedMod: vi.fn(() => Promise.resolve()),
    steamModStates: vi.fn(() => Promise.resolve([{ workshop_id: "10", state: "downloading" }])),
    invalidateReadiness: vi.fn(),
  }),
);

vi.mock("@/hooks/use-server-actions", () => ({
  useServerActions: () => ({ op: null, dayzUp: false, verifyAndJoin }),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, reinstallSubscribedMod, steamModStates };
});

vi.mock("@/stores/readiness-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/readiness-store")>();
  return { ...actual, invalidateReadiness };
});

const captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const key = props?.["data-part"] as string | undefined;
      if (typeof key === "string") captured[key] = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const server = {
  addr: "46.7.13.31",
  query_port: 2303,
  name: "Some Server",
} as Server;

const mod = (id: string, differs: boolean): ModReadinessEntry => ({
  workshop_id: id,
  name: `Mod ${id}`,
  state: "ready",
  size_bytes: null,
  size_is_upper_bound: false,
  preview_url: null,
  is_unique: false,
  downloaded_bytes: null,
  total_bytes: null,
  differs,
});

function cache(mods: ModReadinessEntry[]) {
  setCachedReadiness(server.addr, server.query_port, { stale: false, mods });
}

function render(node: ReactNode, value: Partial<ElementContextValue> = {}): string {
  for (const key of Object.keys(captured)) delete captured[key];
  return renderToStaticMarkup(
    <ElementContextProvider
      value={{ subjectContext: { kind: "server", data: server }, contextName: "modal", ...value }}
    >
      {node}
    </ElementContextProvider>,
  );
}

afterEach(() => {
  verifyAndJoin.mockClear();
  reinstallSubscribedMod.mockClear();
});

describe("ServerModDiffers", () => {
  it("renders nothing without a differing mod", async () => {
    cache([mod("10", false)]);
    const { ServerModDiffers } = await import("./mod-differs");
    expect(render(<ServerModDiffers />)).toBe("");
  });

  it("renders nothing while readiness is still unknown", async () => {
    cache([]);
    const { ServerModDiffers } = await import("./mod-differs");
    expect(render(<ServerModDiffers />, { subjectContext: { kind: "server", data: { ...server, addr: "9.9.9.9" } as Server } })).toBe("");
  });

  it("renders nothing in a list row, where readiness is never fetched", async () => {
    cache([mod("10", true)]);
    const { ServerModDiffers } = await import("./mod-differs");
    expect(render(<ServerModDiffers />, { contextName: "row" })).toBe("");
  });

  it("counts one differing mod in the singular", async () => {
    cache([mod("10", true), mod("20", false)]);
    const { ServerModDiffers } = await import("./mod-differs");
    const html = render(<ServerModDiffers />);
    expect(html).toContain('data-el="server.modDiffers"');
    expect(html).toContain(
      "1 mod differs from the server&#x27;s copy. Fix and join downloads it again first.",
    );
    expect(html).toContain("Fix and join");
    expect(html).not.toContain("--t-color-warn");
  });

  it("counts several differing mods in the plural", async () => {
    cache([mod("10", true), mod("20", true)]);
    const { ServerModDiffers } = await import("./mod-differs");
    const html = render(<ServerModDiffers />);
    expect(html).toContain("2 mods differ from the server&#x27;s copy.");
  });

  it("re-downloads the differing mods and joins from the button", async () => {
    cache([mod("10", true)]);
    const { ServerModDiffers } = await import("./mod-differs");
    render(<ServerModDiffers />);

    (captured["fix"]?.onClick as () => void)();

    await vi.waitFor(() => expect(reinstallSubscribedMod).toHaveBeenCalledWith("10"));
    await vi.waitFor(() => expect(verifyAndJoin).toHaveBeenCalledWith(server));
  });
});
