import { Fragment, useState, type ReactNode } from "react";
import { Globe, Star, Clock, Package, Settings, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import tetraLogo from "@/assets/tetra-logo.png";
import { useResolvedSlot } from "@/theme/use-resolved-layout";

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

/** shell.sidebar nests two levels: these four groups in the rail's own column,
 * and the nav items inside `navList`. A layout orders each set within itself. */
export const TOP_GROUPS = ["logo", "navList", "settingsEntry", "collapseToggle"];
export const NAV_IDS = NAV.map((item) => item.tetraEl);

/** Required by the registry; rendered even if a broken layout claims to hide
 * them, rather than trusting the resolver's refusal to reach this component. */
const REQUIRED_IDS: Record<string, true> = {
  navList: true,
  settingsEntry: true,
  navServers: true,
};

/** `ids` in the order `children` places them, then any of `ids` no layout
 * mentioned. Hiding is `hidden`'s job, checked at render. */
export function orderedByLayout(children: string[], ids: readonly string[]): string[] {
  const present = new Set(children);
  return [...children.filter((id) => ids.includes(id)), ...ids.filter((id) => !present.has(id))];
}

// 176px icon+label rail collapsing to 52px icon-only, both themeable through
// shell.sidebar's `width`/`collapsedWidth`. Width is driven by --side-w on the
// shell so other surfaces track it without subscribing.
export function Sidebar({
  activeView,
  onViewChange,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onCollapsedChange,
}: SidebarProps) {
  const slot = useResolvedSlot("shell.sidebar");
  const hidden = new Set(slot.hidden);
  const [collapsed, setCollapsed] = useState(() => slot.params.defaultCollapsed === true);
  const width = typeof slot.params.width === "string" ? slot.params.width : "176px";
  const right = slot.params.position === "right";

  const navItems = orderedByLayout(slot.children, NAV_IDS)
    .map((tetraEl) => NAV.find((item) => item.tetraEl === tetraEl))
    .filter((item): item is (typeof NAV)[number] => item !== undefined)
    .filter((item) => !hidden.has(item.tetraEl) || REQUIRED_IDS[item.tetraEl]);

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

  const groups: Record<string, ReactNode> = {
    logo: (
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
    ),

    navList: (
      <nav data-tetra-el="navList" className="flex flex-1 flex-col gap-[3px] p-2" aria-label="Main">
        {navItems.map(({ id, label, icon: Icon, tetraEl }, i) => {
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
    ),

    settingsEntry: (
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
    ),

    // Edge tab pinned to the rail's right edge, just above the separator.
    collapseToggle: (
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
        className={
          right
            ? "absolute bottom-24 left-0 z-[5] flex h-[46px] w-[18px] items-center justify-center rounded-r-[4px] border border-line border-l-0 bg-surface2 text-muted transition-colors hover:bg-accent-soft hover:text-accent"
            : "absolute bottom-24 right-0 z-[5] flex h-[46px] w-[18px] items-center justify-center rounded-l-[4px] border border-line border-r-0 bg-surface2 text-muted transition-colors hover:bg-accent-soft hover:text-accent"
        }
      >
        {collapsed ? (
          <ChevronsRight className="h-[13px] w-[13px]" />
        ) : (
          <ChevronsLeft className="h-[13px] w-[13px]" />
        )}
      </button>
    ),
  };

  return (
    <aside
      data-tetra-slot="shell.sidebar"
      className={cn(
        right
          ? "side relative flex shrink-0 flex-col overflow-hidden border-l border-line bg-surface transition-[width] duration-200"
          : "side relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] duration-200",
      )}
      style={{ width: `var(--side-w, ${width})` }}
      data-collapsed={collapsed || undefined}
    >
      {orderedByLayout(slot.children, TOP_GROUPS).map((id) =>
        hidden.has(id) && !REQUIRED_IDS[id] ? null : <Fragment key={id}>{groups[id]}</Fragment>,
      )}
    </aside>
  );
}
