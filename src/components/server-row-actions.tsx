import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Info, Play, ListTree, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Server } from "@/types/server";
import { useServerActions, NOTICES } from "@/hooks/use-server-actions";

interface RowActionsProps {
  server: Server;
  onMoreInfo: (server: Server) => void;
  /**
   * Reports menu open/close so the parent row can lift its z-index while the
   * menu is open. Required because virtualized rows are `transform`ed — each
   * row is its own stacking context, so the menu's z-index can never escape
   * its row and later rows paint over it.
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * D2 — the per-row ⋯ menu. Selection no longer opens a details rail; the row
 * highlights and this menu carries the actions: More info (M1 modal), Join,
 * Load to menu, Download mods.
 */
export function ServerRowActions({ server, onMoreInfo, onOpenChange }: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actions = useServerActions();

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

  return (
    <div ref={ref} className="row-act relative flex shrink-0 items-center gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${server.name || server.addr}`}
        className={cn(
          "rounded-[6px] border border-line bg-surface2 p-[5px] text-muted2 transition-colors hover:border-accent-line hover:text-accent",
          open && "border-accent-line text-accent",
        )}
      >
        <MoreHorizontal className="size-3.5" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className="menu absolute right-0 top-[calc(100%+4px)] z-[6] w-[174px] rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        >
          {busyForThis && (
            <div className="flex items-center gap-1.5 rounded-[5px] px-2.5 py-1.5 text-[10px] font-semibold text-accent">
              <Loader2 className="size-3 animate-spin" />
              <span className="truncate">{actions.phaseLabel(actions.op!)}</span>
            </div>
          )}
          <MenuItem
            icon={<Info className="size-3.5" />}
            label="More info"
            onClick={() => run(() => onMoreInfo(server))}
          />
          <MenuItem
            icon={<Play className="size-3.5" />}
            label="Join"
            disabled={!!actions.op || actions.dayzUp}
            onClick={() => run(() => void actions.verifyAndJoin(false))}
          />
          <MenuItem
            icon={<ListTree className="size-3.5" />}
            label="Load to menu"
            disabled={!!actions.op || actions.dayzUp}
            onClick={() => run(() => void actions.verifyAndJoin(true))}
          />
          <MenuItem
            icon={<Download className="size-3.5" />}
            label="Download mods"
            disabled={!!actions.op}
            onClick={() => run(() => void actions.subscribeOnly())}
          />
          {actions.notice && (
            <div className="mt-1 border-t border-line-weak px-2.5 pb-1 pt-1.5">
              <p
                title={
                  actions.notice.kind === "code"
                    ? NOTICES[actions.notice.code].detail
                    : undefined
                }
                className={cn(
                  "truncate text-[9px] leading-snug",
                  actions.notice.kind === "code" &&
                    NOTICES[actions.notice.code].text.startsWith("E")
                    ? "text-danger"
                    : "text-warn",
                )}
              >
                {actions.notice.kind === "code"
                  ? NOTICES[actions.notice.code].text
                  : actions.notice.text}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
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
