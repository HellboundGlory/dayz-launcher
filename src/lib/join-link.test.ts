import { describe, expect, it } from "vitest";
import { joinLink } from "./join-link";

describe("joinLink", () => {
  it("builds the join page URL from the host and the query port", () => {
    expect(joinLink({ addr: "46.7.13.31:2303", query_port: 27016 })).toBe(
      "https://tetralauncher.com/join?ip=46.7.13.31&port=27016",
    );
  });

  it("keeps a bare host whole when the address has no port", () => {
    expect(joinLink({ addr: "46.7.13.31", query_port: 27016 })).toBe(
      "https://tetralauncher.com/join?ip=46.7.13.31&port=27016",
    );
  });

  it("adds the name and the map when there are some", () => {
    expect(
      joinLink({
        addr: "46.7.13.31:2303",
        query_port: 27016,
        name: "RED HORIZON",
        map: "ChernarusPlus",
      }),
    ).toBe(
      "https://tetralauncher.com/join?ip=46.7.13.31&port=27016&name=RED+HORIZON&map=ChernarusPlus",
    );
  });

  it.each([
    "Wolves & Sheep #3",
    "Test #1",
    "My Server",
    "Černarus Ünïcode",
  ])("round-trips %s through the query string", (name) => {
    const url = new URL(joinLink({ addr: "1.2.3.4:27016", query_port: 27016, name }));
    expect(url.searchParams.get("name")).toBe(name);
  });

  it("leaves out an empty name and an empty map", () => {
    const url = new URL(
      joinLink({ addr: "1.2.3.4:27016", query_port: 27016, name: "", map: "" }),
    );
    expect(url.searchParams.has("name")).toBe(false);
    expect(url.searchParams.has("map")).toBe(false);
  });

  it("cuts a long name to 100 characters", () => {
    const url = new URL(
      joinLink({ addr: "1.2.3.4:27016", query_port: 27016, name: "a".repeat(150) }),
    );
    expect(url.searchParams.get("name")).toBe("a".repeat(100));
  });

  it("uses the query port, not the game port", () => {
    const url = new URL(joinLink({ addr: "1.2.3.4:2302", query_port: 27016 }));
    expect(url.searchParams.get("port")).toBe("27016");
    expect(url.searchParams.get("ip")).toBe("1.2.3.4");
  });
});
