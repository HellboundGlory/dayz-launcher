import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider, useElementContext, type ElementContextValue } from "./context";
import { getPersistedCollapsed } from "../interaction/store";

describe("collapse persistence", () => {
  it("saves a toggled region under the active theme only", () => {
    let ctx!: ElementContextValue;
    function Probe() {
      ctx = useElementContext();
      return null;
    }
    renderToStaticMarkup(
      <ElementContextProvider value={{ themeId: "a" }}>
        <Probe />
      </ElementContextProvider>,
    );
    ctx.toggleCollapsed("r");
    expect(getPersistedCollapsed("a", "r")).toBe(true);
    expect(getPersistedCollapsed("b", "r")).toBe(false);
  });
});
