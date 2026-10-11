import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusActivity, StatusLastRefreshed, StatusListSource, StatusPopulated, StatusServerTotal } from "./status-elements";
import { AppUiScale } from "./app-elements";
import { ElementContextProvider, type ElementContextValue } from "./context";

const render = (node: React.ReactNode, value: Partial<ElementContextValue> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={value}>{node}</ElementContextProvider>,
  );

describe("StatusActivity", () => {
  it.each([
    { name: "discovering", context: { discovering: true, refreshing: false }, state: "discovering", label: "Discovering servers from Steam…" },
    { name: "refreshing", context: { discovering: false, refreshing: true }, state: "refreshing", label: "Probing server details…" },
    { name: "live with the refreshed time", context: { discovering: false, refreshing: false, refreshedAt: "09:32" }, state: "live", label: "Live · 09:32" },
    { name: "live with no refresh yet", context: { discovering: false, refreshing: false, refreshedAt: null }, state: "live", label: "Live · waiting" },
    { name: "disconnected from Steam", context: { steamConnected: false }, state: "live", label: "Live · waiting" },
  ])("shows $label while $name", ({ context, state, label }) => {
    const html = render(<StatusActivity />, context);
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain('data-part="dot"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain(label);
  });
});

describe("StatusLastRefreshed", () => {
  it("honours a custom label option, defaulting it to Updated", () => {
    const value = { steamConnected: true, refreshedAt: "09:32" };
    const plain = render(<StatusLastRefreshed />, value);
    expect(plain).toContain('data-part="label">Updated </span>');
    expect(plain).toContain('data-part="value">09:32</span>');

    expect(render(<StatusLastRefreshed options={{ label: "Refreshed" }} />, value)).toContain(
      'data-part="label">Refreshed </span>',
    );
  });
});

describe("count and source labels", () => {
  const counted = { steamConnected: true, listSource: "index" as const, serverCounts: { total: 3, populated: 2 } };
  it.each([
    { name: "status.serverTotal", node: (o?: Record<string, unknown>) => <StatusServerTotal options={o} />, fallback: " servers" },
    { name: "status.populated", node: (o?: Record<string, unknown>) => <StatusPopulated options={o} />, fallback: " populated" },
    { name: "status.listSource", node: (o?: Record<string, unknown>) => <StatusListSource options={o} />, fallback: ">index<" },
  ])("$name reads its label option, else its launcher wording", ({ node, fallback }) => {
    expect(render(node(), counted)).toContain(fallback);
    expect(render(node({ label: "X" }), counted)).toContain("X</span>");
    expect(render(node({ label: "X" }), counted)).not.toContain(fallback);
  });
});

describe("StatusListSource", () => {
  it.each([
    { source: "index" as const, word: "index", title: "Served by Tetra&#x27;s server index in one request" },
    { source: "steam" as const, word: "Steam", title: "Asked Steam directly — the index was off, unreachable or stale" },
  ])("says via $word with its title", ({ source, word, title }) => {
    const html = render(<StatusListSource />, { steamConnected: true, listSource: source });
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain(`via <span data-part="label">${word}</span>`);
  });
});

describe("AppUiScale", () => {
  it("renders the real scale percentage, not the slider position", () => {
    const html = renderToStaticMarkup(<AppUiScale />);
    expect(html).toContain('data-part="value"');
    expect(html).toContain("125%");
  });
});
