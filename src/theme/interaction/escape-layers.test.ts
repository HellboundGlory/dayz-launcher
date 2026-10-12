import { describe, expect, it } from "vitest";
import { handleEscape, openEscapeLayer } from "./escape-layers";

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
});
