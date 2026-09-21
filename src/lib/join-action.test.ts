import { describe, expect, it } from "vitest";
import { joinAction } from "./join-action";

describe("joinAction", () => {
  it("missing mods, auto-join on: Subscribe & join, joins", () => {
    expect(joinAction({ missingCount: 2, arrivingCount: 0, autoJoinAfterDownload: true })).toEqual({
      label: "Subscribe & join",
      icon: "download",
      joins: true,
    });
  });

  it("missing mods, auto-join off: Subscribe & download, does not join", () => {
    expect(joinAction({ missingCount: 2, arrivingCount: 0, autoJoinAfterDownload: false })).toEqual({
      label: "Subscribe & download",
      icon: "download",
      joins: false,
    });
  });

  it("arriving mods only, auto-join on: Download & join, joins", () => {
    expect(joinAction({ missingCount: 0, arrivingCount: 1, autoJoinAfterDownload: true })).toEqual({
      label: "Download & join",
      icon: "download",
      joins: true,
    });
  });

  it("arriving mods only, auto-join off: Finish downloads, does not join", () => {
    expect(joinAction({ missingCount: 0, arrivingCount: 1, autoJoinAfterDownload: false })).toEqual({
      label: "Finish downloads",
      icon: "download",
      joins: false,
    });
  });

  it("nothing missing or arriving: Join, always joins", () => {
    expect(joinAction({ missingCount: 0, arrivingCount: 0, autoJoinAfterDownload: false })).toEqual({
      label: "Join",
      icon: "play",
      joins: true,
    });
  });
});
