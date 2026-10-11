import { describe, it } from "vitest";
import { SERVER_INFO_MODAL } from "./server-info";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral server info modal", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("modal:serverInfo", SERVER_INFO_MODAL);
  });
});
