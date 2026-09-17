import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Info,
  Play,
  ListTree,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import type { Server } from "@/types/server";
import { useServerActions, NOTICES } from "@/hooks/use-server-actions";
import { useResolvedSlot } from "@/theme/use-resolved-layout";
import { slotChildrenToRender } from "@/theme/slot-children";
import { ComponentTreeRenderer } from "@/theme/component-tree-renderer";
import { useThemeStore } from "@/theme/theme-store";
import { useComponentComposition } from "@/theme/use-component-composition";
import { useServerStore } from "@/stores/server-store";
import {
  checkServerMods,
  getUniqueModsSummary,
  unsubscribeUniqueMods,
  copyServerAddress,
} from "@/lib/tauri";

interface RowActionsProps {
  server: Server;
  onMoreInfo: (server: Server) => void;
  /** Reports menu open/close so the parent row can lift its z-index (virtualized rows are each their own stacking context). */
  onOpenChange?: (open: boolean) => void;
  modPending?: boolean;
}

export const MENU_ITEMS: Record<
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
  checkModsItem: {
    icon: <RefreshCw className="size-3.5" />,
    label: "Check mods",
    disabled: (_joinDisabled, busy) => busy,
  },
  unsubscribeUniqueItem: {
    icon: <Trash2 className="size-3.5" />,
    label: "Unsubscribe unique mods",
    disabled: (_joinDisabled, busy) => busy,
  },
  copyAddressItem: {
    icon: <Copy className="size-3.5" />,
    label: "Copy address",
    disabled: () => false,
  },
};

/** The themeable menu entries, keyed by their `data-tetra-el`. Shared with the
 * registry-order test so adding an item here without registering it fails. */
export const MENU_ITEM_IDS = Object.keys(MENU_ITEMS);

export function ServerRowActions({
  server,
  onMoreInfo,
  onOpenChange,
  modPending: modPendingProp,
}: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => Promise<void> | void;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeId = useThemeStore((s) => s.activeId);
  const composition = useComponentComposition("server.rowActions");

  const actions = useServerActions();
  const hookModPending = useServerStore((s) => s.modPending[server.addr]);
  const storeModPending =
    typeof window === "undefined"
      ? useServerStore.getState().modPending[server.addr]
      : hookModPending;
  const mergeModPending = useServerStore((s) => s.mergeModPending);
  const triggerReload = useServerStore((s) => s.triggerReload);
  const hasPendingMod = modPendingProp !== undefined ? modPendingProp : !!storeModPending;
  const needsFix = server.modded && hasPendingMod;
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

  return (
    <div
      ref={ref}
      data-tetra-slot="server.rowActions"
      className="row-act relative flex shrink-0 items-center gap-[5px]"
    >
      {composition !== null ? (
        <ComponentTreeRenderer node={composition} nodes={composeNodes()} themeId={activeId} />
      ) : (
        <>
          {joinButton()}
          {chevronButton()}
          {noticeInline()}
          {open && dropdownMenu()}
        </>
      )}
      {confirmDialog()}
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
            <span>{needsFix ? "Fix and join" : "Join"}</span>
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
        className="menu absolute right-0 top-[calc(100%+4px)] z-[6] w-[184px] rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
      >
        {slotChildrenToRender(slot, [], MENU_ITEM_IDS).map((id) => (
          <MenuItem
            key={id}
            icon={
              id === "copyAddressItem" && copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                MENU_ITEMS[id].icon
              )
            }
            label={id === "copyAddressItem" && copied ? "Address copied" : MENU_ITEMS[id].label}
            data-tetra-el={id}
            disabled={MENU_ITEMS[id].disabled(joinDisabled, !!actions.op)}
            onClick={() => runItem(id)}
          />
        ))}
        {actions.notice && noticeBlock()}
      </div>
    );
  }

  async function handleCheckMods() {
    try {
      const readiness = await checkServerMods(server.addr, server.query_port);
      const hasPending = readiness.mods.some(
        (m) => m.state !== "ready" && m.state !== "not_on_workshop",
      );
      mergeModPending([{ addr: server.addr, pending: hasPending }]);
      triggerReload();
    } catch (e) {
      actions.setNotice({ kind: "plain", text: String(e) });
    }
  }

  async function handleUnsubscribeUnique() {
    try {
      const summary = await getUniqueModsSummary(server.addr, server.query_port);
      setConfirm({
        title: "Unsubscribe unique mods",
        message: `Unsubscribe ${summary.count} unique mod${summary.count === 1 ? "" : "s"} (${formatBytes(summary.total_size_bytes, 1)}) only used by this server?`,
        action: async () => {
          try {
            const outcome = await unsubscribeUniqueMods(server.addr, server.query_port);
            actions.setNotice({
              kind: "plain",
              text: `Unsubscribed ${outcome.count} unique mod${outcome.count === 1 ? "" : "s"} (${formatBytes(outcome.total_size_bytes, 1)})`,
            });
            triggerReload();
          } catch (e) {
            actions.setNotice({ kind: "plain", text: String(e) });
          }
        },
      });
    } catch (e) {
      actions.setNotice({ kind: "plain", text: String(e) });
    }
  }

  async function handleCopyAddress() {
    try {
      await copyServerAddress(server);
      setCopied(true);
      actions.setNotice({ kind: "plain", text: "Address copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      actions.setNotice({ kind: "plain", text: String(e) });
    }
  }

  function runItem(id: string) {
    run(() => {
      switch (id) {
        case "moreInfoItem":
          onMoreInfo(server);
          break;
        case "loadToMenuItem":
          void actions.verifyAndJoin(server, true);
          break;
        case "downloadModsItem":
          void actions.subscribeOnly(server);
          break;
        case "checkModsItem":
          void handleCheckMods();
          break;
        case "unsubscribeUniqueItem":
          void handleUnsubscribeUnique();
          break;
        case "copyAddressItem":
          void handleCopyAddress();
          break;
      }
    });
  }

  function noticeInline(): React.ReactNode {
    if (!actions.notice) return null;
    const isError =
      actions.notice.kind === "code" &&
      (actions.notice.code.startsWith("E") || NOTICES[actions.notice.code].text.startsWith("E"));
    const text =
      actions.notice.kind === "code" ? NOTICES[actions.notice.code].text : actions.notice.text;
    return (
      <span
        title={
          actions.notice.kind === "code" ? NOTICES[actions.notice.code].detail : undefined
        }
        className={cn(
          "max-w-[140px] truncate text-[9px] leading-snug",
          isError ? "text-danger" : "text-warn",
        )}
      >
        {text}
      </span>
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
            actions.notice!.kind === "code" &&
              (actions.notice!.code.startsWith("E") || NOTICES[actions.notice!.code].text.startsWith("E"))
              ? "text-danger"
              : "text-warn",
          )}
        >
          {actions.notice!.kind === "code" ? NOTICES[actions.notice!.code].text : actions.notice!.text}
        </p>
      </div>
    );
  }

  function confirmDialog(): React.ReactNode {
    if (!confirm) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onClick={() => setConfirm(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={confirm.title}
          className="w-80 rounded-[8px] border border-line bg-surface p-3 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-bold text-ink">{confirm.title}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted2">{confirm.message}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setConfirm(null)}
              className="rounded-[6px] border border-line bg-surface2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void action();
              }}
              className="rounded-[6px] bg-danger px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#10131a] transition-colors hover:brightness-110"
            >
              Unsubscribe
            </button>
          </div>
        </div>
      </div>
    );
  }

  function composeNodes(): Partial<Record<string, React.ReactNode>> {
    const itemNode = (id: string): React.ReactNode => (
      <MenuItem
        data-tetra-el={id}
        icon={
          id === "copyAddressItem" && copied ? (
            <Check className="size-3.5 text-success" />
          ) : (
            MENU_ITEMS[id].icon
          )
        }
        label={id === "copyAddressItem" && copied ? "Address copied" : MENU_ITEMS[id].label}
        disabled={MENU_ITEMS[id].disabled(joinDisabled, !!actions.op)}
        onClick={() => runItem(id)}
      />
    );
    return {
      joinAction: (
        <div className="flex items-center gap-1.5">
          {joinButton()}
          {noticeInline()}
        </div>
      ),
      moreInfoItem: itemNode("moreInfoItem"),
      loadToMenuItem: itemNode("loadToMenuItem"),
      downloadModsItem: itemNode("downloadModsItem"),
      checkModsItem: itemNode("checkModsItem"),
      unsubscribeUniqueItem: itemNode("unsubscribeUniqueItem"),
      copyAddressItem: itemNode("copyAddressItem"),
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
