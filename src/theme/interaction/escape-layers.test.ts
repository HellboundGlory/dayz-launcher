import { describe, expect, it } from "vitest";
import { handleEscape, openEscapeLayer, orderWhileActive } from "./escape-layers";

const escape = () => ({ key: "Escape", preventDefault: () => {} });

describe("escape layers", () => {
  it("closes only the layer opened last, then the one beneath it", () => {
    const closed: string[] = [];
    const closeSettings = openEscapeLayer(() => closed.push("settings"));
    const closeConfirm = openEscapeLayer(() => closed.push("confirm"));

    handleEscape(escape());
    expect(closed).toEqual(["confirm"]);

    closeConfirm();
    handleEscape(escape());
    expect(closed).toEqual(["confirm", "settings"]);

    closeSettings();
    handleEscape(escape());
    expect(closed).toEqual(["confirm", "settings"]);
  });

  it("closes a child before its parent when both mount in one commit", () => {
    const closed: string[] = [];
    // React runs the child's effect first, so it registers before the parent.
    const closeChild = openEscapeLayer(() => closed.push("child"), 2);
    const closeParent = openEscapeLayer(() => closed.push("parent"), 1);

    handleEscape(escape());
    expect(closed).toEqual(["child"]);

    closeChild();
    closeParent();
  });

  it("puts a dialog mounted early above a modal opened before the dialog itself opens", () => {
    const closed: string[] = [];
    const mountedEarly = orderWhileActive(false, null);
    const closeModal = openEscapeLayer(() => closed.push("modal"));
    const closeConfirm = openEscapeLayer(() => closed.push("confirm"), orderWhileActive(true, mountedEarly)!);

    handleEscape(escape());
    expect(closed).toEqual(["confirm"]);

    closeConfirm();
    closeModal();
  });
});
