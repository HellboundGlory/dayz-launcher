import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { NavServers, NavMods } from "./nav-elements";

const render = (node: React.ReactElement, contextValue: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={contextValue}>{node}</ElementContextProvider>,
  );

describe("NavServers", () => {
  it("renders its default lucide icon and label with no options", () => {
    const html = render(<NavServers />);
    expect(html).toContain("lucide-globe");
    expect(html).toContain('data-part="label"');
    expect(html).toContain("Servers");
  });

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
