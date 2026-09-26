import { useContext, useState, type ElementType, type KeyboardEvent } from "react";
import type { TabsNode } from "../renderer/types";
import type { RenderedAttrs } from "../renderer/props";
import { LayoutNodeRenderer, RenderContext } from "../renderer/node-renderer";
import { getPersistedTab, setPersistedTab } from "./store";
import { ResizableHandle } from "./resizable";

/** Which tab index a key press moves to, or `null` if the key is not one of
 * the tab navigation keys for the given orientation. */
export function nextTabIndex({
  key,
  currentIndex,
  count,
  vertical,
}: {
  key: string;
  currentIndex: number;
  count: number;
  vertical: boolean;
}): number | null {
  if (count === 0) return null;
  const forwardKey = vertical ? "ArrowDown" : "ArrowRight";
  const backwardKey = vertical ? "ArrowUp" : "ArrowLeft";

  switch (key) {
    case forwardKey:
      return (currentIndex + 1) % count;
    case backwardKey:
      return (currentIndex - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

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

  const vertical = node.orientation === "vertical";

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const nextIndex = nextTabIndex({ key: e.key, currentIndex, count: node.tabs.length, vertical });
    if (nextIndex === null) return;
    e.preventDefault();

    const target = node.tabs[nextIndex];
    selectTab(target.id);
    if (typeof document !== "undefined") {
      const el = document.getElementById(`${node.id}-tab-${target.id}`);
      el?.focus();
    }
  };

  const activeTabDef = node.tabs.find((t) => t.id === activeTabId) ?? node.tabs[0];

  return (
    <As
      id={attrs.id}
      className={attrs.className}
      style={attrs.style}
      data-tabs={node.id}
      data-region={attrs["data-region"]}
      data-context={attrs["data-context"]}
      data-state={attrs["data-state"]}
    >
      <div role="tablist" data-part="tablist" aria-orientation={vertical ? "vertical" : "horizontal"}>
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
              data-part="tab"
              aria-selected={isActive}
              data-state={isActive ? "selected" : undefined}
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
          data-part="panel"
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
