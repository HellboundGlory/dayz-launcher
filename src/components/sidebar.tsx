import { useState } from "react";
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

// 220px icon+label rail that collapses to 52px icon-only. Width is driven
// 176px icon+label rail that collapses to 52px icon-only. Width is driven
// by --side-w on the shell so other surfaces track it without subscribing.
export function Sidebar({
  activeView,
  onViewChange,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onCollapsedChange,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  /** Arrow-key roving across the nav buttons, same pattern as the settings tabs. */
  function onNavKeyDown(e: React.KeyboardEvent, index: number) {
    const buttons = Array.from(
      e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[data-nav-item]") ?? [],
    );
    if (buttons.length === 0) return;
    let next = index;
    if (e.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (e.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else return;
    e.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <aside
      data-tetra-slot="shell.sidebar"
      className="side relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] duration-200"
      style={{ width: "var(--side-w, 176px)" }}
      data-collapsed={collapsed || undefined}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-line px-3 py-3.5",
          collapsed && "justify-center px-0 py-3.5",
        )}
      >
        <div
          data-tetra-el="logo"
          className={cn("flex min-w-0 items-center gap-2", collapsed && "gap-0")}
        >
          <img
            src={tetraLogo}
            alt=""
            draggable={false}
            className="logo h-[18px] w-[18px] shrink-0 rounded-[4px] shadow-[var(--glow)]"
          />
          {!collapsed && (
            <span className="brand-name truncate text-[13px] font-bold tracking-[0.06em] text-accent">
              TETRA
            </span>
          )}
        </div>
      </div>

      <nav data-tetra-el="navList" className="flex flex-1 flex-col gap-[3px] p-2" aria-label="Main">
        {NAV.map(({ id, label, icon: Icon, tetraEl }, i) => {
          const active = activeView === id;
          return (
            <button
              key={id}
              data-nav-item
              data-tetra-el={tetraEl}
              onClick={() => onViewChange(id)}
              onKeyDown={(e) => onNavKeyDown(e, i)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[12px] font-semibold text-muted transition-colors hover:bg-surface2 hover:text-ink",
                active && "bg-accent-soft text-accent shadow-[var(--glow)]",
                collapsed && "justify-center px-0",
              )}
            >
              <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
              </span>
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-1.5 border-t border-line p-2.5",
          collapsed && "items-center",
        )}
      >
        <button
          data-tetra-el="settingsEntry"
          onClick={() => (settingsOpen ? onCloseSettings() : onOpenSettings())}
          aria-pressed={settingsOpen}
          className={cn(
            "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[12px] font-semibold text-muted transition-colors hover:bg-surface2 hover:text-ink",
            settingsOpen && "bg-accent-soft text-accent shadow-[var(--glow)]",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </span>
          {!collapsed && <span>Settings</span>}
        </button>
      </div>

      {/* Edge tab pinned to the rail's right edge, just above the separator. */}
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
        className="absolute bottom-24 right-0 z-[5] flex h-[46px] w-[18px] items-center justify-center rounded-l-[4px] border border-line border-r-0 bg-surface2 text-muted transition-colors hover:bg-accent-soft hover:text-accent"
      >
        {collapsed ? (
          <ChevronsRight className="h-[13px] w-[13px]" />
        ) : (
          <ChevronsLeft className="h-[13px] w-[13px]" />
        )}
      </button>
    </aside>
  );
}
