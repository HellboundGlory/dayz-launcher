import { describe, expect, it } from "vitest";
import { markPopupAncestors } from "./use-anchored-popup";

class FakeElement {
  readonly attributes = new Set<string>();

  constructor(readonly parentElement: FakeElement | null = null) {}

  setAttribute(name: string) {
    this.attributes.add(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

describe("markPopupAncestors", () => {
  it("keeps a shared ancestor marked until every popup under it has closed", () => {
    const root = new FakeElement();
    const shared = new FakeElement(root);
    const popupA = new FakeElement(new FakeElement(shared));
    const popupB = new FakeElement(new FakeElement(shared));

    const closeA = markPopupAncestors(popupA as unknown as Element);
    const closeB = markPopupAncestors(popupB as unknown as Element);
    closeA();
    expect(shared.attributes.has("data-popup-ancestor")).toBe(true);

    closeB();
    expect(shared.attributes.size).toBe(0);
    expect(root.attributes.size).toBe(0);
  });
});
