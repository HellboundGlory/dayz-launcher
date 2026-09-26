import { useContext, useState, type ElementType, type KeyboardEvent } from "react";
import type { AccordionNode } from "../renderer/types";
import type { RenderedAttrs } from "../renderer/props";
import { LayoutNodeRenderer, RenderContext } from "../renderer/node-renderer";
import { getPersistedAccordion, setPersistedAccordion } from "./store";
import { ResizableHandle } from "./resizable";

export function Accordion({
  node,
  attrs,
  as: As = "div",
}: {
  node: AccordionNode;
  attrs: RenderedAttrs;
  as?: ElementType;
}) {
  const themeCtx = useContext(RenderContext);
  const [openIds, setOpenIds] = useState<string[]>(() => {
    const firstId = node.sections[0]?.id;
    return getPersistedAccordion(themeCtx.themeId, node.id, node.initial, firstId);
  });

  const toggleSection = (id: string) => {
    setOpenIds((prev) => {
      let next: string[];
      if (node.mode === "single") {
        next = prev.includes(id) ? [] : [id];
      } else {
        next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      }
      setPersistedAccordion(themeCtx.themeId, node.id, next);
      return next;
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const count = node.sections.length;
    if (count === 0) return;
    let nextIndex = -1;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        nextIndex = (currentIndex + 1) % count;
        break;
      case "ArrowUp":
        e.preventDefault();
        nextIndex = (currentIndex - 1 + count) % count;
        break;
      case "Home":
        e.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        e.preventDefault();
        nextIndex = count - 1;
        break;
    }

    if (nextIndex >= 0) {
      const target = node.sections[nextIndex];
      if (typeof document !== "undefined") {
        const el = document.getElementById(`${node.id}-header-${target.id}`);
        el?.focus();
      }
    }
  };

  return (
    <As
      id={attrs.id}
      className={attrs.className}
      style={attrs.style}
      data-accordion={node.id}
      data-mode={node.mode}
      data-state={attrs["data-state"]}
    >
      {node.sections.map((section, idx) => {
        const isOpen = openIds.includes(section.id);
        const headerBtnId = `${node.id}-header-${section.id}`;
        const bodyId = `${node.id}-body-${section.id}`;
        return (
          <div
            key={section.id}
            data-section={section.id}
            data-state={isOpen ? "open" : "closed"}
          >
            <button
              type="button"
              id={headerBtnId}
              aria-expanded={isOpen}
              aria-controls={bodyId}
              onClick={() => toggleSection(section.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
            >
              <LayoutNodeRenderer node={section.header} />
            </button>
            <div
              id={bodyId}
              role="region"
              aria-labelledby={headerBtnId}
              hidden={!isOpen}
            >
              {isOpen && <LayoutNodeRenderer node={section.body} />}
            </div>
          </div>
        );
      })}
      {node.resizable && <ResizableHandle node={node} />}
    </As>
  );
}
