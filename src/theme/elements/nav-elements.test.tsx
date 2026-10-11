import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { NavServers, NavMods, NavSettings } from "./nav-elements";

const render = (node: React.ReactElement, contextValue: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={contextValue}>{node}</ElementContextProvider>,
  );

describe("NavServers", () => {
  it("honours the icon option, and none removes it", () => {
    expect(render(<NavServers options={{ icon: "star" }} />)).toContain("lucide-star");
    expect(render(<NavServers options={{ icon: "none" }} />)).not.toContain("<svg");
  });

  it("display: icon hides the label but keeps the accessible name", () => {
    const html = render(<NavServers options={{ display: "icon" }} />);
    expect(html).not.toContain('data-part="label"');
    expect(html).toContain('aria-label="Servers"');
    expect(html).toContain('title="Servers"');
  });
});

describe("NavMods", () => {
  it("honours the icon option", () => {
    expect(render(<NavMods options={{ icon: "package" }} />)).toContain("lucide-package");
  });
});

describe("nav items", () => {
  const tagOf = (html: string, el: string) => html.match(new RegExp(`<button[^>]*data-el="${el}"[^>]*>`))?.[0] ?? "";

  it("mark the active view with aria-current and never use aria-selected or tabindex", () => {
    const html = render(
      <>
        <NavServers />
        <NavMods />
        <NavSettings />
      </>,
      { activeView: "servers" },
    );
    expect(tagOf(html, "nav.servers")).toContain('aria-current="page"');
    expect(tagOf(html, "nav.mods")).not.toContain("aria-current");
    expect(html).not.toContain("aria-selected");
    expect(html).not.toContain("tabindex");
  });
});
