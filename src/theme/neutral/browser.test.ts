import { describe, expect, it } from "vitest";
import { isElementInLayout } from "../layout-query";
import { BROWSER_LAYOUT } from "./browser";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral browser view", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("view:browser", BROWSER_LAYOUT);
  });

  it("leaves the notices to the toast host", () => {
    for (const id of ["notice.launch", "notice.storage", "notice.error"]) {
      expect(isElementInLayout(BROWSER_LAYOUT, id)).toBe(false);
    }
  });
});
