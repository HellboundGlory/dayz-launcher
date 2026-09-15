import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Info, Play, ListTree, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Server } from "@/types/server";
import { useServerActions, NOTICES } from "@/hooks/use-server-actions";
import { useResolvedSlot } from "@/theme/use-resolved-layout";
import { slotChildrenToRender } from "@/theme/slot-children";
import { resolveComponentTree } from "@/theme/component-tree";
import { ComponentTreeRenderer } from "@/theme/component-tree-renderer";
import { SLOTS } from "@/theme/slots";
import { useThemeStore } from "@/theme/theme-store";

interface RowActionsProps {
  server: Server;
  onMoreInfo: (server: Server) => void;
  /** Reports menu open/close so the parent row can lift its z-index (virtualized rows are each their own stacking context). */
  onOpenChange?: (open: boolean) => void;
}

/** The three themeable menu entries — same order as the slot registry, whose
 * resolved order decides where they actually render. */
const MENU_ITEMS: Record<
  string,
  { icon: React.ReactNode; label: string; disabled: (joinDisabled: boolean, busy: boolean) => boolean }
> = {
  moreInfoItem: { icon: <Info className="size-3.5" />, label: "More info", disabled: () => false },
  loadToMenuItem: {
    icon: <ListTree className="size-3.5" />,
    label: "Load to menu",
    disabled: (joinDisabled) => joinDisabled,
  },
  downloadModsItem: {
    icon: <Download className="size-3.5" />,
    label: "Download mods",
    disabled: (_joinDisabled, busy) => busy,
  },
};

/** The themeable menu entries, keyed by their `data-tetra-el`. Shared with the
 * registry-order test so adding an item here without registering it fails. */
export const MENU_ITEM_IDS = Object.keys(MENU_ITEMS);

// Row-level Join button plus a chevron menu for the rest: More info, Load to
// menu, Download mods — same split shape as the More Info modal's Join button.
export function ServerRowActions({ server, onMoreInfo, onOpenChange }: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeId = useThemeStore((s) => s.activeId);
  const themeFiles = useThemeStore((s) => s.themeFiles);
  const composition = useMemo(() => {
    const theme = themeFiles[activeId];
    if (theme === undefined || theme.tier !== "expert") return null;
    const treeJson = theme.components["server.rowActions"];
    if (treeJson === undefined) return null;
    const { tree, issues } = resolveComponentTree(
      "server.rowActions",
      treeJson,
      SLOTS.find((slot) => slot.id === "server.rowActions")?.children ?? [],
    );
    for (const issue of issues) {
      console.warn(`[theme components] ${issue.slotId}: ${issue.message}`);
    }
    return tree;
  }, [activeId, themeFiles]);

  const actions = useServerActions();
  // Only the dropdown's three entries are themeable; joinAction and the chevron
  // keep their own fixed positions.
  const slot = useResolvedSlot("server.rowActions");

  // Ref-fed so an inline parent callback can't retrigger the effect.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    onOpenChangeRef.current?.(open);
    // Unmounting while open (row virtualized away) must not leave the parent
    // thinking a menu is still open.
    return () => {
      if (open) onOpenChangeRef.current?.(false);
    };
  }, [open]);

  // Outside-click close; the trigger is "inside" so its own click toggles
  // instead of closing-then-reopening.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Escape closes; arrows rove the items.
  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  const busyForThis = actions.op && actions.op.addr === server.addr;
  const joinDisabled = !!actions.op || actions.dayzUp;

  // The composed slot has no disclosure primitive, so the three menu items
  // become always-visible standalone buttons there; the chevron dropdown and
  // actions.notice stay fallback-only.
  const nodes = composeNodes();

  return (
    <div
      ref={ref}
      data-tetra-slot="server.rowActions"
      className="row-act relative flex shrink-0 items-center gap-[5px]"
    >
      {composition !== null ? (
        <ComponentTreeRenderer node={composition} nodes={nodes} themeId={activeId} />
      ) : (
        <>
          {joinButton()}
          {chevronButton()}
          {open && dropdownMenu()}
        </>
      )}
    </div>
  );

  function joinButton(): React.ReactNode {
    return (
      <button
        data-tetra-el="joinAction"
        onClick={(e) => {
          e.stopPropagation();
          if (joinDisabled) return;
          setOpen(false);
          void actions.verifyAndJoin(server, false);
        }}
        disabled={joinDisabled}
        title={
          actions.dayzUp && !busyForThis
            ? "DayZ is running. Quit the game before joining another server."
            : undefined
        }
        className="flex shrink-0 items-center gap-1.5 rounded-[6px] bg-accent px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100"
      >
        {busyForThis ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="max-w-[92px] truncate">{actions.phaseLabel(actions.op!)}</span>
          </>
        ) : (
          <>
            {server.modded ? <Download className="size-3.5" /> : <Play className="size-3.5" />}
            <span>Join</span>
          </>
        )}
      </button>
    );
  }

  function chevronButton(): React.ReactNode {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${server.name || server.addr}`}
        className={cn(
          "rounded-[6px] border border-line bg-surface2 p-[5px] text-muted2 transition-colors hover:border-accent-line hover:text-accent",
          open && "border-accent-line text-accent",
        )}
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
    );
  }

  function dropdownMenu(): React.ReactNode {
    return (
      <div
        ref={menuRef}
        role="menu"
        onKeyDown={onMenuKeyDown}
        className="menu absolute right-0 top-[calc(100%+4px)] z-[6] w-[174px] rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
      >
        {slotChildrenToRender(slot, [], MENU_ITEM_IDS).map((id) => (
          <MenuItem
            key={id}
            icon={MENU_ITEMS[id].icon}
            label={MENU_ITEMS[id].label}
            data-tetra-el={id}
            disabled={MENU_ITEMS[id].disabled(joinDisabled, !!actions.op)}
            onClick={() => runItem(id)}
          />
        ))}
        {actions.notice && noticeBlock()}
      </div>
    );
  }

  function runItem(id: string) {
    run(() =>
      id === "moreInfoItem"
        ? onMoreInfo(server)
        : id === "loadToMenuItem"
          ? void actions.verifyAndJoin(server, true)
          : void actions.subscribeOnly(server),
    );
  }

  function noticeBlock(): React.ReactNode {
    return (
      <div className="mt-1 border-t border-line-weak px-2.5 pb-1 pt-1.5">
        <p
          title={
            actions.notice!.kind === "code" ? NOTICES[actions.notice!.code].detail : undefined
          }
          className={cn(
            "truncate text-[9px] leading-snug",
            actions.notice!.kind === "code" && NOTICES[actions.notice!.code].text.startsWith("E")
              ? "text-danger"
              : "text-warn",
          )}
        >
          {actions.notice!.kind === "code" ? NOTICES[actions.notice!.code].text : actions.notice!.text}
        </p>
      </div>
    );
  }

  function composeNodes(): Partial<Record<string, React.ReactNode>> {
    const itemNode = (id: string): React.ReactNode => (
      <MenuItem
        data-tetra-el={id}
        icon={MENU_ITEMS[id].icon}
        label={MENU_ITEMS[id].label}
        disabled={MENU_ITEMS[id].disabled(joinDisabled, !!actions.op)}
        onClick={() => {
          if (id === "moreInfoItem") {
            onMoreInfo(server);
          } else if (id === "loadToMenuItem") {
            void actions.verifyAndJoin(server, true);
          } else {
            void actions.subscribeOnly(server);
          }
        }}
      />
    );
    return {
      joinAction: joinButton(),
      moreInfoItem: itemNode("moreInfoItem"),
      loadToMenuItem: itemNode("loadToMenuItem"),
      downloadModsItem: itemNode("downloadModsItem"),
    };
  }
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  "data-tetra-el": dataTetraEl,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  "data-tetra-el"?: string;
}) {
  return (
    <button
      role="menuitem"
      data-tetra-el={dataTetraEl}
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[7px] text-left text-[11px] font-semibold text-ink transition-colors hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center text-muted2">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
