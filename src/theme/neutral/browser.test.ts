import { describe, expect, it } from "vitest";
import { isElementInLayout } from "../layout-query";
import { BROWSER_LAYOUT } from "./browser";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral browser view", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("view:browser", BROWSER_LAYOUT);
  });

  it("places the launch notice", () => {
    expect(isElementInLayout(BROWSER_LAYOUT, "notice.launch")).toBe(true);
  });
});
