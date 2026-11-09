import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CountryFlag } from "./country-flag";
import { FLAG_URLS, flagUrl } from "@/lib/country-flag";

describe("flagUrl", () => {
  it("gives a URL for a real code and nothing for a missing one", () => {
    expect(flagUrl("DE")).toBeTruthy();
    expect(flagUrl("ZZ")).toBeNull();
    expect(flagUrl(null)).toBeNull();
    expect(Object.keys(FLAG_URLS)).toHaveLength(257);
  });
});

describe("CountryFlag", () => {
  it("draws an image for a known code", () => {
    const html = renderToStaticMarkup(<CountryFlag code="DE" />);
    expect(html).toContain("<img");
    expect(html).toContain(`src="${FLAG_URLS.DE}"`);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws nothing for a code with no flag", () => {
    expect(renderToStaticMarkup(<CountryFlag code="ZZ" />)).toBe("");
    expect(renderToStaticMarkup(<CountryFlag code={null} />)).toBe("");
  });
});
