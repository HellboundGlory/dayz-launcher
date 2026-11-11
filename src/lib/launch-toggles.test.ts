import { describe, expect, it } from "vitest";
import { LAUNCH_TOGGLES, hasLaunchFlag, setLaunchFlag } from "./launch-toggles";

const typed = ["-cpuCount=4", "-profiles=C:\\My Docs\\DayZ"];

describe("LAUNCH_TOGGLES", () => {
  it("lists the four flags in order", () => {
    expect(LAUNCH_TOGGLES.map((t) => t.flag)).toEqual([
      "-skipIntro",
      "-nosplash",
      "-noPause",
      "-window",
    ]);
  });
});

describe("setLaunchFlag", () => {
  it.each([
    { flag: "-skipIntro", off: [] },
    { flag: "-nosplash", off: [] },
    { flag: "-noPause", off: [], on: ["-noPause"] },
    { flag: "-window", off: [] },
  ])("adds $flag at the end and leaves hand-typed lines alone", ({ flag }) => {
    expect(setLaunchFlag(typed, flag, true)).toEqual([...typed, flag]);
  });

  it("removes only the matching line", () => {
    expect(setLaunchFlag(["-skipIntro", ...typed, "-window"], "-skipIntro", false)).toEqual([
      ...typed,
      "-window",
    ]);
  });

  it("removes a copy in a different case", () => {
    expect(setLaunchFlag(["-NoPause", "-cpuCount=4"], "-noPause", false)).toEqual(["-cpuCount=4"]);
  });

  it("removes every copy", () => {
    expect(setLaunchFlag(["-noPause", "-x", "-NOPAUSE"], "-noPause", false)).toEqual(["-x"]);
  });

  it("adds no duplicate when any case is already present", () => {
    expect(setLaunchFlag(["-NoPause"], "-noPause", true)).toEqual(["-NoPause"]);
  });

  it("treats -window=1 as a different line", () => {
    expect(setLaunchFlag(["-window=1"], "-window", true)).toEqual(["-window=1", "-window"]);
    expect(setLaunchFlag(["-window=1"], "-window", false)).toEqual(["-window=1"]);
  });

  it("returns a new array", () => {
    const params = ["-x"];
    expect(setLaunchFlag(params, "-window", true)).not.toBe(params);
    expect(setLaunchFlag(params, "-window", false)).not.toBe(params);
  });
});

describe("hasLaunchFlag", () => {
  it.each([
    { name: "a typed flag", params: ["-window"], flag: "-window", expected: true },
    { name: "spaces and other case", params: [" -WINDOW "], flag: "-window", expected: true },
    { name: "a longer line", params: ["-window=1"], flag: "-window", expected: false },
    { name: "an empty list", params: [], flag: "-window", expected: false },
  ])("$name gives $expected", ({ params, flag, expected }) => {
    expect(hasLaunchFlag(params, flag)).toBe(expected);
  });
});
