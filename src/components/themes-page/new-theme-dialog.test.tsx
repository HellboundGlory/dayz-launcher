import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewThemeBox } from "./new-theme-dialog";

describe("NewThemeBox", () => {
  it("shows the prefilled name and the taken-name line", () => {
    const html = renderToStaticMarkup(
      <NewThemeBox
        name="Copy of Neutral"
        error='A theme named "Copy of Neutral" already exists.'
        pending={false}
        onNameChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(html).toContain('value="Copy of Neutral"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("A theme named &quot;Copy of Neutral&quot; already exists.");
  });
});
