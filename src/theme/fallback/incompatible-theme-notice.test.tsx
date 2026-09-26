/** SPEC §16.3's one-time notice: names the switched-off theme and dismisses through the store. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IncompatibleThemeNotice } from "./incompatible-theme-notice";

const store = vi.hoisted(() => {
  const state = {
    incompatibleSwitch: null as { id: string; name: string } | null,
    dismissCalls: 0,
    dismissIncompatibleSwitch: () => {
      state.dismissCalls += 1;
      state.incompatibleSwitch = null;
    },
  };
  return state;
});

vi.mock("../theme-store", () => ({
  useThemeStore: (selector: (state: unknown) => unknown) => selector(store),
}));

// renderToStaticMarkup drops event handlers, so the button's props are captured by data-part.
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") captured[part] = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

beforeEach(() => {
  store.incompatibleSwitch = null;
  store.dismissCalls = 0;
  for (const part of Object.keys(captured)) delete captured[part];
});

describe("IncompatibleThemeNotice", () => {
  it("names the theme that was switched off", () => {
    store.incompatibleSwitch = { id: "local.old", name: "Old Timer" };

    const html = renderToStaticMarkup(<IncompatibleThemeNotice />);

    expect(html).toContain('data-part="incompatible-theme-notice"');
    expect(html).toContain('role="status"');
    expect(html).toContain(
      "Old Timer uses an older theme format and was switched off. You can delete it from Settings → Themes.",
    );
  });

  it("renders nothing once the switch has been dismissed", () => {
    expect(renderToStaticMarkup(<IncompatibleThemeNotice />)).toBe("");
  });

  it("dismisses through the store", () => {
    store.incompatibleSwitch = { id: "local.old", name: "Old Timer" };
    renderToStaticMarkup(<IncompatibleThemeNotice />);

    (captured["dismiss"].onClick as () => void)();

    expect(store.dismissCalls).toBe(1);
  });
});
