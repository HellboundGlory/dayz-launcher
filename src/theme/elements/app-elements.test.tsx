import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppMinimize, AppMaximize, AppClose, AppSchemeToggle } from "./app-elements";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(() => Promise.resolve()),
    maximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => {})),
  }),
}));

const schemeState = { scheme: "dark" as "dark" | "light", setScheme: vi.fn() };
vi.mock("@/theme/theme-store", () => ({
  useThemeStore: (selector: (s: typeof schemeState) => unknown) => selector(schemeState),
}));

describe("AppMinimize / AppMaximize / AppClose", () => {
  it("render their default lucide icon when no option is set", () => {
    expect(renderToStaticMarkup(<AppMinimize />)).toContain("lucide-minus");
    expect(renderToStaticMarkup(<AppMaximize />)).toContain("lucide-square");
    expect(renderToStaticMarkup(<AppClose />)).toContain("lucide-x");
  });

  it("honours the icon option, and none removes it", () => {
    expect(renderToStaticMarkup(<AppMinimize options={{ icon: "check" }} />)).toContain("lucide-check");
    expect(renderToStaticMarkup(<AppMinimize options={{ icon: "none" }} />)).not.toContain("<svg");
  });
});

describe("AppSchemeToggle", () => {
  it("defaults to the scheme's own icon", () => {
    schemeState.scheme = "dark";
    expect(renderToStaticMarkup(<AppSchemeToggle />)).toContain("lucide-sun");
    schemeState.scheme = "light";
    expect(renderToStaticMarkup(<AppSchemeToggle />)).toContain("lucide-moon");
  });

  it("honours the icon option regardless of scheme", () => {
    schemeState.scheme = "dark";
    expect(renderToStaticMarkup(<AppSchemeToggle options={{ icon: "star" }} />)).toContain("lucide-star");
  });
});
