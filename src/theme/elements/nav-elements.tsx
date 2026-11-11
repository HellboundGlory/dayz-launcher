import type { CSSProperties, KeyboardEvent } from "react";
import { useState } from "react";
import { Globe, Star, Clock, Network, Package, Settings, type LucideIcon } from "lucide-react";
import { useElementContext, type ViewId } from "./context";
import { OptionIcon } from "./option-icon";
import { parseDisplay } from "./element-utils";

/** The LAN tab's "New" tag stays until the tab has been opened once. */
const LAN_SEEN_KEY = "tetra.lan.seen";

/**
 * Whether the LAN tab has been opened before. A storage that cannot be read
 * reports "not seen", so the tag still shows; a write that fails just means the
 * tag comes back next launch.
 */
export function lanSeen(): boolean {
  try {
    return localStorage.getItem(LAN_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

export function markLanSeen(): void {
  try {
    localStorage.setItem(LAN_SEEN_KEY, "1");
  } catch {
    // Non-fatal: the tag simply shows again next launch.
  }
}

export function onNavKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
  const container = e.currentTarget.closest('nav, [data-landmark="navigation"]');
  if (!container) return;
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-el^='nav.']"));
  const index = buttons.indexOf(e.currentTarget);
  if (index === -1) return;

  let next = index;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    next = (index + 1) % buttons.length;
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    next = (index - 1 + buttons.length) % buttons.length;
  } else if (e.key === "Home") {
    next = 0;
  } else if (e.key === "End") {
    next = buttons.length - 1;
  } else {
    return;
  }
  e.preventDefault();
  buttons[next]?.focus();
}

interface NavItemProps {
  id: string;
  label: string;
  defaultIcon: LucideIcon;
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
  /** A tag drawn after the label, e.g. the LAN tab's "New". */
  badge?: React.ReactNode;
  /** Runs when the item opens its view. */
  onActivate?: () => void;
}

function NavItem({
  id,
  label,
  defaultIcon: DefaultIcon,
  options,
  className,
  style,
  badge,
  onActivate,
}: NavItemProps) {
  const { activeView, onViewChange, settingsOpen, onOpenSettings, onCloseSettings } =
    useElementContext();

  const isSettings = id === "nav.settings";
  const viewMap: Record<string, ViewId> = {
    "nav.servers": "servers",
    "nav.favourites": "fav",
    "nav.recent": "recent",
    "nav.lan": "lan",
    "nav.mods": "mods",
  };
  const targetView = viewMap[id];
  const isActive = isSettings ? settingsOpen : activeView === targetView;

  const { showIcon, showLabel } = parseDisplay(options, "iconLabel");

  const handleClick = () => {
    if (isSettings) {
      if (settingsOpen) onCloseSettings();
      else onOpenSettings();
    } else if (targetView) {
      onViewChange(targetView);
      if (settingsOpen) onCloseSettings();
    }
    onActivate?.();
  };

  const state = isSettings ? (isActive ? "open" : undefined) : isActive ? "current" : undefined;

  return (
    <button
      type="button"
      data-el={id}
      data-state={state}
      aria-current={!isSettings && isActive ? "page" : undefined}
      aria-pressed={isSettings ? isActive : undefined}
      onClick={handleClick}
      // A mouse click shouldn't leave the keyboard focus ring on the tab (WebKitGTK shows it).
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={onNavKeyDown}
      title={showIcon && !showLabel ? label : undefined}
      aria-label={label}
      className={className ?? "flex items-center gap-[var(--t-space-sidebarItemGap)] px-3 py-1 [font-size:var(--t-type-size-lg)] leading-4 font-bold uppercase tracking-wider transition-colors"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon" className="flex shrink-0 items-center justify-center">
          <OptionIcon icon={options?.icon} fallback={DefaultIcon} className="size-[var(--t-space-iconMedium)]" />
        </span>
      )}
      {showLabel && <span data-part="label" className="truncate">{label}</span>}
      {badge}
    </button>
  );
}

export const NavServers = (props: Omit<NavItemProps, "id" | "label" | "defaultIcon">) => (
  <NavItem id="nav.servers" label="Servers" defaultIcon={Globe} {...props} />
);

export const NavFavourites = (props: Omit<NavItemProps, "id" | "label" | "defaultIcon">) => (
  <NavItem id="nav.favourites" label="Favourites" defaultIcon={Star} {...props} />
);

export const NavRecent = (props: Omit<NavItemProps, "id" | "label" | "defaultIcon">) => (
  <NavItem id="nav.recent" label="Recent" defaultIcon={Clock} {...props} />
);

export const NavLan = (props: Omit<NavItemProps, "id" | "label" | "defaultIcon">) => {
  const [seen, setSeen] = useState(lanSeen);
  return (
    <NavItem
      id="nav.lan"
      label="LAN"
      defaultIcon={Network}
      {...props}
      badge={seen ? undefined : <span data-part="badge">New</span>}
      onActivate={() => {
        markLanSeen();
        setSeen(true);
        props.onActivate?.();
      }}
    />
  );
};

export const NavMods = (props: Omit<NavItemProps, "id" | "label" | "defaultIcon">) => (
  <NavItem id="nav.mods" label="Mods" defaultIcon={Package} {...props} />
);

export const NavSettings = (props: Omit<NavItemProps, "id" | "label" | "defaultIcon">) => (
  <NavItem id="nav.settings" label="Settings" defaultIcon={Settings} {...props} />
);
