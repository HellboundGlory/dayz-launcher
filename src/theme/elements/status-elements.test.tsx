import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusActivity, StatusLastRefreshed } from "./status-elements";
import { AppUiScale } from "./app-elements";
import { ElementContextProvider, type ElementContextValue } from "./context";

const render = (node: React.ReactNode, value: Partial<ElementContextValue> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={value}>{node}</ElementContextProvider>,
  );

describe("StatusActivity", () => {
  it("shows the discovering state and message", () => {
    const html = render(<StatusActivity />, { discovering: true, refreshing: false });
    expect(html).toContain('data-state="discovering"');
    expect(html).toContain('data-part="dot"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain("Discovering servers from Steam…");
  });

  it("shows the refreshing state and message", () => {
    const html = render(<StatusActivity />, { discovering: false, refreshing: true });
    expect(html).toContain('data-state="refreshing"');
    expect(html).toContain("Probing server details…");
  });

  it("shows live with the refreshed time", () => {
    const html = render(<StatusActivity />, {
      discovering: false,
      refreshing: false,
      refreshedAt: "09:32",
    });
    expect(html).toContain('data-state="live"');
    expect(html).toContain("Live · 09:32");
  });

  it("shows live · waiting with no refreshedAt", () => {
    const html = render(<StatusActivity />, {
      discovering: false,
      refreshing: false,
      refreshedAt: null,
    });
    expect(html).toContain('data-state="live"');
    expect(html).toContain("Live · waiting");
  });

  it("renders regardless of Steam connection state", () => {
    const html = render(<StatusActivity />, { steamConnected: false });
    expect(html).toContain('data-el="status.activity"');
  });
});

describe("StatusLastRefreshed", () => {
  it("honours a custom label option", () => {
    const html = render(<StatusLastRefreshed options={{ label: "Refreshed" }} />, {
      steamConnected: true,
      refreshedAt: "09:32",
    });
    expect(html).toContain('data-part="label"');
    expect(html).toContain("Refreshed");
    expect(html).toContain('data-part="value"');
    expect(html).toContain("09:32");
  });

  it("defaults the label to Updated", () => {
    const html = render(<StatusLastRefreshed />, {
      steamConnected: true,
      refreshedAt: "09:32",
    });
    expect(html).toContain("Updated");
  });
});

describe("AppUiScale", () => {
  it("renders the real scale percentage, not the slider position", () => {
    const html = renderToStaticMarkup(<AppUiScale />);
    expect(html).toContain('data-part="value"');
    expect(html).toContain("125%");
  });
});
