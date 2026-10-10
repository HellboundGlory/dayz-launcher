import { describe, expect, it } from "vitest";
import { isElementInLayout } from "../layout-query";
import { SERVER_INFO_MODAL } from "./server-info";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral server info modal", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("modal:serverInfo", SERVER_INFO_MODAL);
  });

  it("serverInfo modal contains all modal:serverInfo required elements", () => {
    expect(isElementInLayout(SERVER_INFO_MODAL, "modal.close")).toBe(true);
    expect(isElementInLayout(SERVER_INFO_MODAL, "server.join")).toBe(true);
    expect(isElementInLayout(SERVER_INFO_MODAL, "server.actionNotice")).toBe(true);
  });
});
