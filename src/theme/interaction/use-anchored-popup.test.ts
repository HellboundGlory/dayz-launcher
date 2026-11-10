import { describe, expect, it, vi } from "vitest";
import { showInTopLayer, showOverlayInTopLayer } from "./use-anchored-popup";

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

  readonly children: FakePopup[] = [];

  contains(other: FakePopup): boolean {
    return other === this || this.children.some((c) => c.contains(other));
  }
}

class FakeHost extends FakePopup {
  constructor(
    private readonly position: string,
    private readonly popovers: FakePopup[] = [],
    private readonly onTop: FakePopup[] = [],
  ) {
    super();
  }

  readonly ownerDocument = {
    defaultView: {
      getComputedStyle: () => ({ position: this.position }),
    },
    querySelectorAll: (selector: string) =>
      selector === "[data-stay-on-top]:popover-open" ? this.onTop.filter((e) => e.open) : [],
  };

  querySelectorAll(selector: string) {
    if (selector !== ":popover-open") return [];
    return this.popovers.filter((p) => p.matches(selector));
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

describe("showOverlayInTopLayer", () => {
  it("leaves a host its CSS does not fix in place", () => {
    const host = new FakeHost("absolute");

    const close = showOverlayInTopLayer(asElement(host));
    close();

    expect(host.writes).toEqual([]);
    expect(host.showPopover).not.toHaveBeenCalled();
    expect(host.hidePopover).not.toHaveBeenCalled();
  });

  it("opens a fixed host and closes it again with the cleanup", () => {
    const host = new FakeHost("fixed");

    const close = showOverlayInTopLayer(asElement(host));
    expect(host.attributes.get("popover")).toBe("manual");
    expect(host.showPopover).toHaveBeenCalledTimes(1);

    close();
    expect(host.hidePopover).toHaveBeenCalledTimes(1);
    expect(host.attributes.has("popover")).toBe(false);
  });

  it("shows a popup already open inside the host again, after the host", () => {
    const popup = new FakePopup();
    showInTopLayer(asElement(popup));
    popup.showPopover.mockClear();
    popup.hidePopover.mockClear();
    const host = new FakeHost("fixed", [popup]);

    showOverlayInTopLayer(asElement(host));

    expect(popup.hidePopover).toHaveBeenCalledTimes(1);
    expect(popup.showPopover).toHaveBeenCalledTimes(1);
    expect(host.showPopover.mock.invocationCallOrder[0]).toBeLessThan(
      popup.hidePopover.mock.invocationCallOrder[0],
    );
    expect(popup.hidePopover.mock.invocationCallOrder[0]).toBeLessThan(
      popup.showPopover.mock.invocationCallOrder[0],
    );
  });

  it("keeps what stays on top above a host it shows", () => {
    const edge = new FakePopup();
    showInTopLayer(asElement(edge));
    edge.showPopover.mockClear();
    const host = new FakeHost("fixed", [], [edge]);

    showOverlayInTopLayer(asElement(host));

    expect(edge.showPopover).toHaveBeenCalledTimes(1);
    expect(host.showPopover.mock.invocationCallOrder[0]).toBeLessThan(
      edge.showPopover.mock.invocationCallOrder[0],
    );
  });

  it("does not raise a stay-on-top element over a host inside it", () => {
    const outer = new FakePopup();
    showInTopLayer(asElement(outer));
    outer.showPopover.mockClear();
    const host = new FakeHost("fixed", [], [outer]);
    outer.children.push(host);

    showOverlayInTopLayer(asElement(host));

    expect(outer.showPopover).not.toHaveBeenCalled();
  });

  it("leaves a fixed host alone where the browser has no Popover API", () => {
    const host = new FakeHost("fixed");
    Object.defineProperty(host, "showPopover", { value: undefined });
    Object.defineProperty(host, "querySelectorAll", {
      value: () => {
        throw new Error(":popover-open is not a valid selector here");
      },
    });

    expect(() => showOverlayInTopLayer(asElement(host))()).not.toThrow();
    expect(host.writes).toEqual([]);
  });
});
