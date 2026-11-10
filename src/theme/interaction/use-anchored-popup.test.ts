import { describe, expect, it, vi } from "vitest";
import { showInTopLayer } from "./use-anchored-popup";

class FakePopup {
  readonly attributes = new Map<string, string>();
  readonly writes: string[] = [];
  open = false;
  // Like a browser, showing needs the popover attribute already set.
  readonly showPopover = vi.fn(() => {
    if (!this.attributes.has("popover")) throw new Error("not a popover");
    this.open = true;
  });
  readonly hidePopover = vi.fn(() => {
    this.open = false;
  });

  setAttribute(name: string, value = "") {
    this.writes.push(name);
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  matches(selector: string) {
    return selector === ":popover-open" && this.open;
  }
}

function asElement(popup: FakePopup): HTMLElement {
  return popup as unknown as HTMLElement;
}

describe("showInTopLayer", () => {
  it("opens the popup with the manual popover attribute", () => {
    const popup = new FakePopup();

    showInTopLayer(asElement(popup));

    expect(popup.attributes.get("popover")).toBe("manual");
    expect(popup.showPopover).toHaveBeenCalledTimes(1);
  });

  it("hides the popup and drops the attribute when the cleanup runs", () => {
    const popup = new FakePopup();

    const close = showInTopLayer(asElement(popup));
    close();

    expect(popup.hidePopover).toHaveBeenCalledTimes(1);
    expect(popup.attributes.has("popover")).toBe(false);
  });

  it("does not hide a popup the browser already closed", () => {
    const popup = new FakePopup();

    const close = showInTopLayer(asElement(popup));
    popup.open = false;
    close();

    expect(popup.hidePopover).not.toHaveBeenCalled();
    expect(popup.attributes.has("popover")).toBe(false);
  });

  it("leaves a browser without the Popover API alone", () => {
    const popup = new FakePopup();
    Object.defineProperty(popup, "showPopover", { value: undefined });

    const close = showInTopLayer(asElement(popup));
    close();

    expect(popup.writes).toEqual([]);
    expect(popup.hidePopover).not.toHaveBeenCalled();
  });

  it("drops the attribute again when showPopover throws", () => {
    const popup = new FakePopup();
    popup.showPopover.mockImplementation(() => {
      throw new Error("not connected");
    });

    const close = showInTopLayer(asElement(popup));
    close();

    expect(popup.attributes.has("popover")).toBe(false);
    expect(popup.hidePopover).not.toHaveBeenCalled();
  });
});
