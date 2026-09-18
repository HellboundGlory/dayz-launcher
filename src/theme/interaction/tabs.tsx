import { useContext, useState, type ElementType, type KeyboardEvent } from "react";
import type { TabsNode } from "../renderer/types";
import type { RenderedAttrs } from "../renderer/props";
import { LayoutNodeRenderer, RenderContext } from "../renderer/node-renderer";
import { getPersistedTab, setPersistedTab } from "./store";
import { ResizableHandle } from "./resizable";

export function Tabs({
  node,
  attrs,
  as: As = "div",
}: {
  node: TabsNode;
  attrs: RenderedAttrs;
  as?: ElementType;
}) {
  const themeCtx = useContext(RenderContext);
  const defaultTab = node.tabs[0]?.id;
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const persisted = getPersistedTab(themeCtx.themeId, node.id, defaultTab);
    return node.tabs.some((t) => t.id === persisted) ? (persisted ?? defaultTab) : defaultTab;
  });

  const selectTab = (tabId: string) => {
    setActiveTabId(tabId);
    setPersistedTab(themeCtx.themeId, node.id, tabId);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const count = node.tabs.length;
    if (count === 0) return;
    let nextIndex = -1;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        nextIndex = (currentIndex + 1) % count;
        break;
      case "ArrowLeft":
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
      const target = node.tabs[nextIndex];
      selectTab(target.id);
      if (typeof document !== "undefined") {
        const el = document.getElementById(`${node.id}-tab-${target.id}`);
        el?.focus();
      }
    }
  };

  const activeTabDef = node.tabs.find((t) => t.id === activeTabId) ?? node.tabs[0];

  return (
    <As
      id={attrs.id}
      className={attrs.className}
      style={attrs.style}
      data-tabs={node.id}
      data-state={attrs["data-state"]}
    >
      <div role="tablist" aria-orientation="horizontal">
        {node.tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabDef?.id;
          const tabBtnId = `${node.id}-tab-${tab.id}`;
          const panelId = `${node.id}-panel-${tab.id}`;
          return (
            <button
              key={tab.id}
              type="button"
              id={tabBtnId}
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              data-tab={tab.id}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
            >
              <LayoutNodeRenderer node={tab.label} />
            </button>
          );
        })}
      </div>
      {activeTabDef && (
        <div
          role="tabpanel"
          id={`${node.id}-panel-${activeTabDef.id}`}
          aria-labelledby={`${node.id}-tab-${activeTabDef.id}`}
          tabIndex={0}
        >
          <LayoutNodeRenderer node={activeTabDef.content} />
        </div>
      )}
      {node.resizable && <ResizableHandle node={node} />}
    </As>
  );
}
