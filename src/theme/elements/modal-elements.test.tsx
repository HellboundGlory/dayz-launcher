import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { ModalClose } from "./modal-elements";

let capturedProps: Record<string, unknown> | null = null;

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (props["data-el"] === "modal.close") capturedProps = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

beforeEach(() => {
  capturedProps = null;
});

describe("ModalClose", () => {
  it("renders an icon button labelled Close", () => {
    const html = renderToStaticMarkup(<ModalClose />);
    expect(html).toContain('data-el="modal.close"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('data-part="icon"');
    expect(html).toContain("lucide-x");
  });

  it("honours the icon option", () => {
    const html = renderToStaticMarkup(<ModalClose options={{ icon: "check" }} />);
    expect(html).toContain("lucide-check");
  });

  it("calls closeModal when clicked", () => {
    const closeModal = vi.fn();
    renderToStaticMarkup(
      <ElementContextProvider value={{ closeModal }}>
        <ModalClose />
      </ElementContextProvider>,
    );
    (capturedProps?.onClick as (e: { stopPropagation: () => void }) => void)?.({
      stopPropagation: vi.fn(),
    });
    expect(closeModal).toHaveBeenCalledTimes(1);
  });
});
