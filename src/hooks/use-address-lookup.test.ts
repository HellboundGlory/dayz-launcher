import { describe, expect, it } from "vitest";
import { addressToAsk } from "./use-address-lookup";

describe("addressToAsk", () => {
  it("asks again for an address searched, cleared and typed again", () => {
    let asked: string | null = null;
    const settle = (search: string, total: number) => {
      const next = addressToAsk({ search, total }, asked);
      asked = next.asked;
      return next.addr;
    };

    expect(settle("1.2.3.4:2302", 0)).toBe("1.2.3.4:2302");
    expect(settle("1.2.3.4:2302", 0)).toBeNull();
    settle("", 500);
    expect(settle("1.2.3.4:2302", 0)).toBe("1.2.3.4:2302");
  });
});
