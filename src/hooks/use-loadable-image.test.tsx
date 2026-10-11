import { describe, expect, it } from "vitest";
import { useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useLoadableImage } from "./use-loadable-image";

// The browser reports a failed image after it loads; the probe does it during render.
function Probe({ url, next, broken }: { url: string; next?: string; broken?: string }) {
  const [current, setCurrent] = useState(url);
  const [image, reportBroken] = useLoadableImage(current);
  const reported = useRef(false);
  if (image && image === broken && !reported.current) {
    reported.current = true;
    reportBroken();
    if (next) setCurrent(next);
  }
  return <span>{image ?? "placeholder"}</span>;
}

describe("useLoadableImage", () => {
  it("keeps a url until its image errors, then drops it and tries a new one", () => {
    expect(renderToStaticMarkup(<Probe url="a.png" />)).toContain("a.png");
    expect(renderToStaticMarkup(<Probe url="a.png" broken="a.png" />)).toContain("placeholder");
    expect(renderToStaticMarkup(<Probe url="a.png" next="b.png" broken="a.png" />)).toContain("b.png");
  });
});
