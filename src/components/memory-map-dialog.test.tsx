import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/memory-map-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/memory-map-store")>();
  return { ...actual, useMemoryMapStore: liveHook(actual.useMemoryMapStore) };
});

const captured: Record<string, Record<string, unknown>[]> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") (captured[part] ??= []).push(props);
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const status = { current: 65530, recommended: 1048576 };
const raise = "sudo sysctl -w vm.max_map_count=1048576";
const keep = "echo 'vm.max_map_count=1048576' | sudo tee /etc/sysctl.d/80-dayz.conf";

let written: string[] = [];

beforeEach(() => {
  written = [];
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: vi.fn(async (text: string) => {
        written.push(text);
      }),
    },
  });
});

afterEach(async () => {
  const { useMemoryMapStore } = await import("@/stores/memory-map-store");
  useMemoryMapStore.getState().answer(false, false);
  for (const key of Object.keys(captured)) delete captured[key];
  vi.unstubAllGlobals();
});

async function open() {
  const { MemoryMapDialog } = await import("./memory-map-dialog");
  const { useMemoryMapStore } = await import("@/stores/memory-map-store");
  void useMemoryMapStore.getState().ask(status);
  return renderToStaticMarkup(<MemoryMapDialog />);
}

describe("MemoryMapDialog", () => {
  it("renders nothing with no request", async () => {
    const { MemoryMapDialog } = await import("./memory-map-dialog");
    expect(renderToStaticMarkup(<MemoryMapDialog />)).toBe("");
  });

  it("shows the title, the sub line and both numbers", async () => {
    const html = await open();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-part="title"');
    expect(html).toContain("DayZ may crash on this system");
    expect(html).toContain('data-part="sub"');
    expect(html).toContain("Linux memory map limit");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("65530");
    expect(html).toContain("1048576");
  });

  it("shows both labels and both commands in full", async () => {
    const html = await open();
    expect(html).toContain("Raise it until the next restart");
    expect(html).toContain("Keep it after restarts");
    expect(html).toContain(raise);
    expect(html).toContain("vm.max_map_count=1048576&#x27; | sudo tee /etc/sysctl.d/80-dayz.conf");
    expect(html.match(/data-part="command"/g)).toHaveLength(2);
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("break-all");
  });

  it("gives each Copy button the same full-size class as Join", async () => {
    await open();
    const copies = captured["copy"] ?? [];
    expect(copies).toHaveLength(2);
    expect(copies[0].className).toBe(copies[1].className);
    expect(copies[0].className).toBe(captured["join"][0].className);
    expect(copies.map((props) => props["aria-label"])).toEqual([
      "Copy the command that raises the limit until the next restart",
      "Copy the command that keeps the limit after restarts",
    ]);
  });

  it("copies the exact command and then reads Copied", async () => {
    await open();
    const click = captured["copy"][1].onClick as () => Promise<void>;
    await click();
    expect(written).toEqual([keep]);
  });

  it("does not throw when the copy is refused", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    await open();
    const click = captured["copy"][0].onClick as () => void;
    expect(() => click()).not.toThrow();
    await Promise.resolve();
  });

  it("offers a don't-warn box that starts off", async () => {
    const html = await open();
    expect(html).toContain("Don&#x27;t warn me again");
    expect(html).toContain('data-part="dontWarn"');
    expect(html).not.toMatch(/data-part="dontWarn"[^>]*checked/);
  });

  it("answers join and cancel", async () => {
    const { useMemoryMapStore } = await import("@/stores/memory-map-store");
    const answer = vi.spyOn(useMemoryMapStore.getState(), "answer");
    await open();

    (captured["join"][0].onClick as () => void)();
    expect(answer).toHaveBeenCalledWith(true, false);

    (captured["cancel"][0].onClick as () => void)();
    expect(answer).toHaveBeenCalledWith(false, false);
  });
});
