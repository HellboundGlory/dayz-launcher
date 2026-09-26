// SPEC §5.2: a file may declare `variants` instead of `root`, and every host
// that draws a layout file must pick the variant for the width it renders at.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LayoutVariant, ModalLayoutFile, PopupLayoutFile, SettingsLayoutFile } from "../renderer/types";
import { ModalHost } from "./modal-host";
import { PopupHost } from "./popup-host";
import { SettingsHost } from "./settings-host";

const viewport = vi.hoisted(() => ({ width: 650 }));
const devState = vi.hoisted(() => ({ variantWidth: null as number | null }));

vi.mock("../renderer/use-viewport-width", () => ({
  useViewportWidth: () => viewport.width,
}));
vi.mock("@/theme/dev/dev-store", () => ({
  useDevStore: Object.assign(
    (selector: (s: typeof devState) => unknown) => selector(devState),
    { getState: () => devState },
  ),
}));

type HostFile = SettingsLayoutFile & ModalLayoutFile & PopupLayoutFile;

const VARIANTS: LayoutVariant[] = [
  { minWidth: 0, root: { type: "box", id: "r-narrow", children: [] } },
  { minWidth: 900, root: { type: "box", id: "r-wide", children: [] } },
];

// The host prop types still spell `root` as required, so a variants-only
// fixture goes through one cast.
const variantsFile = () => ({ schemaVersion: 2, variants: VARIANTS }) as unknown as HostFile;

const PLAIN = { schemaVersion: 2, root: { type: "text" as const, value: "plain-root" } };

const HOSTS: { name: string; render: (file: HostFile) => string }[] = [
  { name: "SettingsHost", render: (file) => renderToStaticMarkup(<SettingsHost file={file} />) },
  { name: "ModalHost", render: (file) => renderToStaticMarkup(<ModalHost file={file} onClose={() => {}} />) },
  { name: "PopupHost", render: (file) => renderToStaticMarkup(<PopupHost file={file} onClose={() => {}} />) },
];

afterEach(() => {
  viewport.width = 650;
  devState.variantWidth = null;
});

describe.each(HOSTS)("$name width variants", ({ render }) => {
  it("renders the minWidth 0 root at a narrow width", () => {
    viewport.width = 650;
    const html = render(variantsFile());
    expect(html).toContain('id="r-narrow"');
    expect(html).not.toContain('id="r-wide"');
  });

  it("renders the wide root at a wide width", () => {
    viewport.width = 1400;
    const html = render(variantsFile());
    expect(html).toContain('id="r-wide"');
    expect(html).not.toContain('id="r-narrow"');
  });

  it("renders the Dev Mode width's variant over the viewport's", () => {
    viewport.width = 650;
    devState.variantWidth = 1400;
    expect(render(variantsFile())).toContain('id="r-wide"');
  });

  it("renders a root file unchanged", () => {
    viewport.width = 650;
    expect(render(PLAIN as HostFile)).toContain("plain-root");
  });
});
