import { useState, type ReactNode } from "react";
import { Globe, Star, Clock, Package, Settings, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import tetraLogo from "@/assets/tetra-logo.png";

export type ViewId = "servers" | "fav" | "recent" | "mods";

interface SidebarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  /** Lift the collapsed state so the shell can set `--side-w` (the settings
      overlay's left edge tracks the rail width without subscribing). */
  onCollapsedChange?: (collapsed: boolean) => void;
}

const NAV: { id: ViewId; label: string; icon: typeof Globe; tetraEl: string }[] = [
  { id: "servers", label: "Servers", icon: Globe, tetraEl: "navServers" },
  { id: "fav", label: "Favourites", icon: Star, tetraEl: "navFavourites" },
  { id: "recent", label: "Recent", icon: Clock, tetraEl: "navRecent" },
  { id: "mods", label: "Mods", icon: Package, tetraEl: "navMods" },
];

export const TOP_GROUPS = ["logo", "navList", "settingsEntry", "collapseToggle"];
export const NAV_IDS = NAV.map((item) => item.tetraEl);

export function orderedByLayout(children: string[], ids: readonly string[]): string[] {
  const present = new Set(children);
  return [...children.filter((id) => ids.includes(id)), ...ids.filter((id) => !present.has(id))];
}

// 176px icon+label rail collapsing to 52px icon-only. Width is driven by --side-w
// on the shell so other surfaces track it without subscribing.
export function Sidebar({
  activeView,
  onViewChange,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onCollapsedChange,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  function onNavKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const buttons = Array.from(
      e.currentTarget
        .closest("aside")
        ?.querySelectorAll<HTMLButtonElement>("[data-nav-item]") ?? [],
    );
    const index = buttons.indexOf(e.currentTarget);
    if (index === -1) return;
    let next = index;
    if (e.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (e.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else return;
    e.preventDefault();
    buttons[next]?.focus();
  }

  function renderNavItem({ id, label, icon: Icon, tetraEl }: (typeof NAV)[number]): ReactNode {
    const active = activeView === id;
    return (
      <button
        key={id}
        data-nav-item
        data-tetra-el={tetraEl}
        onClick={() => onViewChange(id)}
        onKeyDown={onNavKeyDown}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-[var(--t-space-sidebarItemGap)] [border-radius:var(--t-radius-sidebarItem)] px-[var(--t-space-controlSmallX)] py-[var(--t-space-rowY)] [font-size:var(--t-type-subheading-size)] [font-weight:var(--t-type-label-weight)] text-muted transition-colors [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] hover:bg-surface2 hover:text-ink",
          active && "bg-accent-soft text-accent [box-shadow:var(--t-glow-selected)]",
          collapsed && "justify-center px-0",
        )}
      >
        <span className="flex h-[var(--t-space-iconBox)] w-[var(--t-space-iconBox)] shrink-0 items-center justify-center">
          <Icon className="h-[var(--t-space-iconLarge)] w-[var(--t-space-iconLarge)]" strokeWidth={1.6} />
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    );
  }

  return (
    <aside
      className="side relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] [transition-duration:var(--t-motion-expand-duration)] [transition-timing-function:var(--t-motion-expand-easing)]"
      style={{ width: "var(--side-w, var(--t-space-sidebarWidth))" }}
      data-collapsed={collapsed || undefined}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-line px-[var(--t-space-rowX)] py-[var(--t-space-sidebarLogoY)]",
          collapsed && "justify-center px-0 py-[var(--t-space-sidebarLogoY)]",
        )}
      >
        <div
          data-tetra-el="logo"
          className={cn("flex min-w-0 items-center gap-[var(--t-space-inlineGapWide)]", collapsed && "gap-0")}
        >
          <img
            src={tetraLogo}
            alt=""
            draggable={false}
            className="logo h-[var(--t-space-iconLarge)] w-[var(--t-space-iconLarge)] shrink-0 [border-radius:var(--t-radius-controlSmall)] [box-shadow:var(--t-glow-rest)]"
          />
          {!collapsed && (
            <span className="brand-name truncate [font-size:var(--t-type-brand-size)] [font-weight:var(--t-type-button-weight)] [letter-spacing:var(--t-type-brand-tracking)] text-accent">
              TETRA
            </span>
          )}
        </div>
      </div>

      <nav data-tetra-el="navList" className="flex flex-1 flex-col gap-[var(--t-space-sidebarListGap)] p-[var(--t-space-sidebarPad)]" aria-label="Main">
        {NAV.map((item) => renderNavItem(item))}
      </nav>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-[var(--t-space-inlineGap)] border-t border-line p-[var(--t-space-sidebarSettingsPad)]",
          collapsed && "items-center",
        )}
      >
        <button
          data-tetra-el="settingsEntry"
          onClick={() => (settingsOpen ? onCloseSettings() : onOpenSettings())}
          aria-pressed={settingsOpen}
          className={cn(
            "flex items-center gap-[var(--t-space-sidebarItemGap)] [border-radius:var(--t-radius-sidebarItem)] px-[var(--t-space-controlSmallX)] py-[var(--t-space-rowY)] [font-size:var(--t-type-subheading-size)] [font-weight:var(--t-type-label-weight)] text-muted transition-colors [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] hover:bg-surface2 hover:text-ink",
            settingsOpen && "bg-accent-soft text-accent [box-shadow:var(--t-glow-selected)]",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="flex h-[var(--t-space-iconBox)] w-[var(--t-space-iconBox)] shrink-0 items-center justify-center">
            <Settings className="h-[var(--t-space-iconLarge)] w-[var(--t-space-iconLarge)]" strokeWidth={1.6} />
          </span>
          {!collapsed && <span>Settings</span>}
        </button>
      </div>

      <button
        data-tetra-el="collapseToggle"
        onClick={() => {
          setCollapsed((c) => {
            const next = !c;
            onCollapsedChange?.(next);
            return next;
          });
        }}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute bottom-[var(--t-space-sidebarToggleOffset)] right-0 z-[5] flex h-[var(--t-space-sidebarToggleHeight)] w-[var(--t-space-iconLarge)] items-center justify-center [border-top-left-radius:var(--t-radius-controlSmall)] [border-bottom-left-radius:var(--t-radius-controlSmall)] border border-line border-r-0 bg-surface2 text-muted transition-colors [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] hover:bg-accent-soft hover:text-accent"
      >
        {collapsed ? (
          <ChevronsRight className="h-[var(--t-space-iconChevron)] w-[var(--t-space-iconChevron)]" />
        ) : (
          <ChevronsLeft className="h-[var(--t-space-iconChevron)] w-[var(--t-space-iconChevron)]" />
        )}
      </button>
    </aside>
  );
}
