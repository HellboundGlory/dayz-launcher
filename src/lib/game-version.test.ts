import { describe, expect, it } from "vitest";
import { versionMismatch } from "./game-version";

describe("versionMismatch", () => {
  const cases: {
    name: string;
    server: string;
    installed: string | null;
    expected: { server: string; yours: string } | null;
  }[] = [
    {
      name: "the same build",
      server: "1.30.164289",
      installed: "1.30.164289",
      expected: null,
    },
    {
      name: "another build",
      server: "1.28.161464",
      installed: "1.29.163709",
      expected: { server: "1.28.161464", yours: "1.29.163709" },
    },
    { name: "installed unknown", server: "1.30.164289", installed: null, expected: null },
    { name: "installed empty", server: "1.30.164289", installed: "", expected: null },
    { name: "server unknown", server: "", installed: "1.30.164289", expected: null },
    { name: "both empty", server: "", installed: "", expected: null },
    {
      name: "surrounding spaces",
      server: " 1.28.161464 ",
      installed: " 1.29.163709",
      expected: { server: "1.28.161464", yours: "1.29.163709" },
    },
    {
      name: "only whitespace on the server",
      server: "   ",
      installed: "1.29.163709",
      expected: null,
    },
  ];

  for (const { name, server, installed, expected } of cases) {
    it(name, () => {
      expect(versionMismatch(server, installed)).toEqual(expected);
    });
  }
});
