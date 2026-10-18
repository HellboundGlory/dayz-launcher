import { describe, expect, it } from "vitest";
import { addressInSearch } from "./address";

describe("addressInSearch", () => {
  it.each([
    { text: "40.160.57.146:2402", want: "40.160.57.146:2402" },
    { text: "  40.160.57.146:2402  ", want: "40.160.57.146:2402" },
    { text: "10.0.0.1:65535", want: "10.0.0.1:65535" },
    { text: "40.160.57.146", want: null },
    { text: "40.160.57.146:0", want: null },
    { text: "40.160.57.146:70000", want: null },
    { text: "40.160.57.146 : 2402", want: null },
    { text: "40.160.57.146:2402 extra", want: null },
    { text: "[::1]:2402", want: null },
    { text: "256.1.1.1:2402", want: null },
    { text: "pulse", want: null },
  ])("$text -> $want", ({ text, want }) => {
    expect(addressInSearch(text)).toBe(want);
  });
});
