import { useEffect, useRef, useState } from "react";
import {
  X,
  Play,
  Download,
  ChevronDown,
  Loader2,
  Check,
  ListTree,
  RefreshCw,
  Trash2,
  Copy,
  Package,
} from "lucide-react";
import type { Server, ServerModReadiness, ModReadinessEntry } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { cn, formatBytes, formatGameTime, regionName } from "@/lib/utils";
import { useServerActions, NOTICES } from "@/hooks/use-server-actions";
import { SlotChildren } from "@/theme/slot-render";
import { useResolvedSlot } from "@/theme/use-resolved-layout";
import { resolveChildOrder } from "@/theme/slot-order";
import { useComponentComposition } from "@/theme/use-component-composition";
import { ComponentTreeRenderer } from "@/theme/component-tree-renderer";
import { useThemeStore } from "@/theme/theme-store";
import {
  serverModReadiness,
  checkServerMods,
  getUniqueModsSummary,
  unsubscribeUniqueMods,
  copyServerAddress,
  type ModState,
} from "@/lib/tauri";

interface ServerInfoModalProps {
  server: Server;
  onClose: () => void;
  initialReadiness?: ServerModReadiness;
}

// "More info" modal, opened from the row ⋯ menu. Focus trapped; Escape, ✕
// and backdrop click close.
export function ServerInfoModal({ server, onClose, initialReadiness }: ServerInfoModalProps) {
  const actions = useServerActions();
  const modPending = useServerStore((s) => s.modPending);
  const mergeModPending = useServerStore((s) => s.mergeModPending);
  const triggerReload = useServerStore((s) => s.triggerReload);

  const [readinessData, setReadinessData] = useState<ServerModReadiness | null>(
    initialReadiness ?? null,
  );
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [checkingMods, setCheckingMods] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => Promise<void> | void;
  } | null>(null);

  const [loadOpen, setLoadOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const joinRef = useRef<HTMLButtonElement>(null);
  const loadMenuRef = useRef<HTMLDivElement>(null);
  const loadToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (initialReadiness) return;
    let cancelled = false;
    if (server.modded) {
      setLoadingReadiness(true);
      serverModReadiness(server.addr, server.query_port)
        .then((res) => {
          if (!cancelled) setReadinessData(res);
        })
        .catch((e) => {
          console.error("Failed to fetch server mod readiness:", e);
        })
        .finally(() => {
          if (!cancelled) setLoadingReadiness(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [server.addr, server.query_port, server.modded, initialReadiness]);

  // Focus the primary action on open; Escape + outside click close. The
  // outside-click guard requires the mousedown to start inside and end outside
  // for a close, so a click starting on the backdrop always closes.
  useEffect(() => {
    joinRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close the LOAD menu on outside mousedown (toggle counts as inside).
  useEffect(() => {
    if (!loadOpen) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (loadMenuRef.current?.contains(t) || loadToggleRef.current?.contains(t)) return;
      setLoadOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [loadOpen]);

  /** Tab wraps within the modal; Shift+Tab goes backwards. */
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const els = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((el) => !el.hasAttribute("disabled"));
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const ping = server.ping;
  const pingColor =
    ping === null ? "text-muted" : ping > 120 ? "text-danger" : ping > 80 ? "text-warn" : "text-success";

  const pending = modPending[server.addr];
  const readiness = pending
    ? { tone: "warn", text: "Mod update pending — verify before join" }
    : server.modded && server.mod_count === null
      ? { tone: "warn", text: "Mods not checked — verify before join" }
      : server.mod_count === 0
        ? { tone: "ok", text: "No mods declared" }
        : { tone: "ok", text: `${server.mod_count} mod${server.mod_count === 1 ? "" : "s"} declared` };

  const busy = !!actions.op;
  const result =
    actions.launchResult && actions.launchResult.addr === server.addr
      ? actions.launchResult
      : null;

  const bodyOrder = resolveChildOrder(
    "modal.serverInfo",
    ["statGrid", "readinessStrip", "propsList", "readinessList"],
    useResolvedSlot("modal.serverInfo").children,
  );

  const activeId = useThemeStore((s) => s.activeId);
  const composition = useComponentComposition("modal.serverInfo");

  const downloadSummaryText = (() => {
    if (!readinessData) return null;
    let totalBytes = 0;
    let hasUpper = false;
    let needsUpdateCount = 0;
    for (const m of readinessData.mods) {
      if (m.state !== "ready" && m.state !== "not_on_workshop") {
        needsUpdateCount++;
        const sz = m.size_bytes;
        if (typeof sz === "number") totalBytes += sz;
        if (m.size_is_upper_bound) hasUpper = true;
      }
    }
    if (needsUpdateCount === 0) return "Download size: 0 bytes";
    const formatted = formatBytes(totalBytes, 1);
    return hasUpper ? `Download size: up to ${formatted}` : `Download size: ${formatted}`;
  })();

  function closeIfOutside(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="ovl absolute inset-0 z-[60] flex items-center justify-center [background-color:var(--t-color-scrim)]"
      onMouseDown={closeIfOutside}
    >
      <div
        ref={wrapRef}
        data-tetra-slot="modal.serverInfo"
        role="dialog"
        aria-modal="true"
        aria-label={`Server info: ${server.name || server.addr}`}
        onKeyDown={trapTab}
        className="modal w-[min(480px,calc(100%-40px))] max-h-[85vh] flex flex-col overflow-hidden [border-radius:var(--t-radius-modal)] border border-line bg-surface [box-shadow:var(--t-shadow-modal)]"
      >
        <div className="modal-wrap relative flex flex-col min-h-0 flex-1">
          <button
            data-tetra-el="closeAction"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-2.5 z-[2] text-muted transition-colors hover:text-ink"
          >
            <X className="size-4" />
          </button>

          <div className="m-identity shrink-0 p-3.5">
            <h2 className="[font-size:var(--t-type-heading-size)] font-bold leading-snug text-ink">
              {server.name || server.addr}
            </h2>
            <p className="mt-0.5 font-mono-data [font-size:var(--t-type-data-size)] text-muted">
              {server.addr}
              {server.game_port > 0 && ` · game port ${server.game_port}`}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {!server.online && <Badge tone="danger">OFFLINE</Badge>}
              {server.official ? (
                <Badge tone="success">OFFICIAL</Badge>
              ) : server.modded ? (
                <Badge tone="accent2">MODDED</Badge>
              ) : null}
              {server.first_person && <Badge tone="muted">1PP</Badge>}
              {server.battleye && <Badge tone="accent">BATTLEYE</Badge>}
              {server.locked && <Badge tone="danger">LOCKED</Badge>}
            </div>
          </div>

          {composition !== null ? (
            <ComponentTreeRenderer
              node={composition}
              nodes={{
                closeAction: closeAction(),
                statGrid: statGrid(),
                readinessStrip: readinessStrip(),
                propsList: propsList(),
                readinessList: readinessList(),
                joinAction: joinBlock(),
              }}
              themeId={activeId}
            />
          ) : (
            <>
              {closeAction()}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SlotChildren
                  order={bodyOrder}
                  nodes={{
                    statGrid: statGrid(),
                    readinessStrip: readinessStrip(),
                    propsList: propsList(),
                    readinessList: readinessList(),
                  }}
                />
              </div>
              <div className="m-actions shrink-0 border-t border-line px-3.5 pb-3.5 pt-2.5">
                {noticeLine()}
                {joinBlock()}
                {resultLine()}
              </div>
            </>
          )}
          {confirmDialog()}
        </div>
      </div>
    </div>
  );

  function closeAction(): React.ReactNode {
    return (
      <button
        data-tetra-el="closeAction"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-2.5 z-[2] text-muted transition-colors hover:text-ink"
      >
        <X className="size-4" />
      </button>
    );
  }

  function statGrid(): React.ReactNode {
    return (
      <div
        data-tetra-el="statGrid"
        className="m-band grid grid-cols-3 gap-px border-b border-line bg-line"
      >
        <Stat label="Players" value={`${server.players}/${server.max_players}`} className="text-accent2" />
        <Stat
          label="Ping ms"
          value={server.online && ping !== null ? String(ping) : "—"}
          className={server.online ? pingColor : "text-muted"}
        />
        <Stat
          label="Time"
          value={formatGameTime(server.in_game_time, server.day_multiplier, server.night_multiplier)}
          className="text-accent"
        />
      </div>
    );
  }

  function readinessStrip(): React.ReactNode {
    return (
      <div
        data-tetra-el="readinessStrip"
        className="flex items-center gap-1.5 border-b border-line px-3.5 py-2 [font-size:var(--t-type-label-size)] text-muted"
      >
        <span
          className={cn(
            "inline-block h-[7px] w-[7px] rounded-full",
            readiness.tone === "warn"
              ? "bg-warn [box-shadow:var(--t-shadow-readinessWarning)]"
              : "bg-success [box-shadow:var(--t-shadow-readinessSuccess)]",
          )}
        />
        {readiness.text}
      </div>
    );
  }

  function propsList(): React.ReactNode {
    return (
      <div data-tetra-el="propsList" className="m-props px-3.5 py-2">
        <Prop label="Map" value={server.map_display || "—"} />
        <Prop label="Version" value={server.version || "unknown"} />
        <Prop label="Region" value={regionName(server.country_code)} />
        <Prop label="Mods" value={server.mod_count != null ? String(server.mod_count) : server.modded ? "?" : "0"} />
      </div>
    );
  }

  function joinBlock(): React.ReactNode {
    if (busy) {
      return (
        <div className="flex gap-1.5">
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 [border-radius:var(--t-radius-control)] bg-surface2 px-4 py-2 [font-size:var(--t-type-button-size)] font-bold uppercase tracking-wider text-accent ring-1 ring-accent-line">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="truncate">{actions.phaseLabel(actions.op!)}</span>
          </div>
          {actions.op!.phase !== "launching" && actions.op!.phase !== "starting" && (
            <button
              onClick={actions.cancelWait}
              className="shrink-0 [border-radius:var(--t-radius-control)] bg-surface2 px-3 py-2 [font-size:var(--t-type-button-size)] font-semibold uppercase tracking-wider text-muted2 ring-1 ring-line transition-colors hover:text-danger"
            >
              Cancel
            </button>
          )}
        </div>
      );
    }
    if (actions.dayzUp) {
      return (
        <button
          disabled
          title="DayZ is running. Quit the game before joining another server."
          className="flex w-full items-center justify-center gap-1.5 [border-radius:var(--t-radius-control)] bg-success px-4 py-2 [font-size:var(--t-type-button-size)] font-bold uppercase tracking-wider [color:var(--t-color-onSuccess)]"
        >
          <Check className="size-3.5" />
          <span>PLAYING</span>
        </button>
      );
    }
    const hasPendingMod =
      pending ||
      (readinessData?.mods.some(
        (m) => m.state !== "ready" && m.state !== "not_on_workshop",
      ) ??
        false);
    const needsFix = server.modded && hasPendingMod;

    return (
      <div className="relative flex w-full gap-1">
        <button
          ref={joinRef}
          data-tetra-el="joinAction"
          onClick={() => void actions.verifyAndJoin(server, false)}
          className="flex min-w-0 flex-1 items-center justify-center gap-1.5 [border-radius:var(--t-radius-control)] bg-accent px-4 py-2 [font-size:var(--t-type-button-size)] font-bold uppercase tracking-wider [color:var(--t-color-onAccent)] [box-shadow:var(--t-shadow-glow)] transition-colors hover:brightness-110"
        >
          {server.modded ? <Download className="size-3.5" /> : <Play className="size-3.5" />}
          <span>{needsFix ? "Fix and join" : "Join"}</span>
        </button>
        <button
          ref={loadToggleRef}
          onClick={() => setLoadOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={loadOpen}
          title="Load this server's mods to the main menu"
          className="flex shrink-0 items-center justify-center [border-radius:var(--t-radius-control)] bg-accent px-2 [color:var(--t-color-onAccent)] [box-shadow:var(--t-shadow-glow)] transition-colors hover:brightness-110"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", loadOpen && "rotate-180")} />
        </button>
        {loadOpen && (
          <div
            ref={loadMenuRef}
            role="menu"
            // Opens upward — the modal's overflow-hidden clips a downward
            // menu on this last-row position.
            className="absolute bottom-full right-0 z-[6] mb-1 w-56 [border-radius:var(--t-radius-popup)] border border-line bg-surface2 p-1 [box-shadow:var(--t-shadow-popup)]"
          >
            <button
              role="menuitem"
              onClick={() => {
                setLoadOpen(false);
                void actions.verifyAndJoin(server, true);
              }}
              title="Verify the mod list, then launch DayZ to the main menu with this server's mods loaded — it does not join the server."
              className="flex w-full items-center gap-2 [border-radius:var(--t-radius-popupItem)] px-3 py-2 text-left [font-size:var(--t-type-body-size)] font-bold uppercase tracking-wider text-ink transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <ListTree className="size-3.5 text-muted2" />
              <span>Load</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  async function handleCheckMods() {
    setCheckingMods(true);
    try {
      const res = await checkServerMods(server.addr, server.query_port);
      setReadinessData(res);
      const hasPending = res.mods.some(
        (m) => m.state !== "ready" && m.state !== "not_on_workshop",
      );
      mergeModPending([{ addr: server.addr, pending: hasPending }]);
      triggerReload();
    } catch (e) {
      actions.setNotice({ kind: "plain", text: String(e) });
    } finally {
      setCheckingMods(false);
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
              text: `Unsubscribed ${outcome.count} mod${outcome.count === 1 ? "" : "s"} (${formatBytes(outcome.total_size_bytes, 1)})`,
            });
            const fresh = await serverModReadiness(server.addr, server.query_port);
            setReadinessData(fresh);
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
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (e) {
      actions.setNotice({ kind: "plain", text: String(e) });
    }
  }

  function readinessList(): React.ReactNode {
    return (
      <div data-tetra-el="readinessList" className="m-readiness border-b border-line px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          <button
            type="button"
            onClick={handleCheckMods}
            disabled={checkingMods || busy}
            className="inline-flex items-center gap-1.5 [border-radius:var(--t-radius-controlCompact)] border border-line bg-surface2 px-2.5 py-1 [font-size:var(--t-type-button-size)] font-semibold text-ink transition-colors hover:bg-accent-soft hover:text-accent disabled:opacity-40"
          >
            <RefreshCw className={cn("size-3", checkingMods && "animate-spin")} />
            <span>Check mods</span>
          </button>
          <button
            type="button"
            onClick={() => void actions.subscribeOnly(server)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 [border-radius:var(--t-radius-controlCompact)] border border-line bg-surface2 px-2.5 py-1 [font-size:var(--t-type-button-size)] font-semibold text-ink transition-colors hover:bg-accent-soft hover:text-accent disabled:opacity-40"
          >
            <Download className="size-3" />
            <span>Download mods</span>
          </button>
          <button
            type="button"
            onClick={handleUnsubscribeUnique}
            disabled={busy}
            className="inline-flex items-center gap-1.5 [border-radius:var(--t-radius-controlCompact)] border border-line bg-surface2 px-2.5 py-1 [font-size:var(--t-type-button-size)] font-semibold text-ink transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="size-3" />
            <span>Unsubscribe unique</span>
          </button>
          <button
            type="button"
            onClick={handleCopyAddress}
            className="inline-flex items-center gap-1.5 [border-radius:var(--t-radius-controlCompact)] border border-line bg-surface2 px-2.5 py-1 [font-size:var(--t-type-button-size)] font-semibold text-ink transition-colors hover:bg-accent-soft hover:text-accent"
          >
            {copiedAddress ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
            <span>{copiedAddress ? "Address copied" : "Copy address"}</span>
          </button>
        </div>

        {downloadSummaryText && (
          <div className="flex items-center justify-between gap-2 pb-2 [font-size:var(--t-type-label-size)]">
            <span className="font-semibold text-muted">
              {readinessData ? `${readinessData.mods.length} mod${readinessData.mods.length === 1 ? "" : "s"}` : ""}
            </span>
            <span className="font-mono-data font-semibold text-ink">{downloadSummaryText}</span>
          </div>
        )}

        {loadingReadiness ? (
          <div className="flex items-center justify-center py-4 [font-size:var(--t-type-label-size)] text-muted">
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            <span>Checking mod readiness…</span>
          </div>
        ) : !readinessData || readinessData.mods.length === 0 ? (
          <div className="py-2 text-center [font-size:var(--t-type-label-size)] text-muted">
            {server.modded ? "No mods found or not probed yet." : "No mods required."}
          </div>
        ) : (
          <div className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto pr-1">
            {readinessData.mods.map((mod) => (
              <div
                key={mod.workshop_id}
                className="flex items-center gap-2 [border-radius:var(--t-radius-readinessRow)] border border-line bg-surface2 px-2.5 py-1.5 [font-size:var(--t-type-body-size)]"
              >
                {mod.preview_url ? (
                  <img
                    src={mod.preview_url}
                    alt=""
                    className="size-7 shrink-0 rounded object-cover border border-line-weak"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded border border-line-weak bg-surface text-muted">
                    <Package className="size-3.5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-ink">{mod.name || mod.workshop_id}</span>
                    {mod.is_unique && <Badge tone="accent2">Unique</Badge>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 [font-size:var(--t-type-data-size)] text-muted">
                    <span className="font-mono-data">{formatModSize(mod)}</span>
                    {mod.downloaded_bytes != null &&
                      mod.total_bytes != null &&
                      mod.state === "downloading" && (
                        <span className="font-mono-data">
                          {formatBytes(mod.downloaded_bytes, 1)} / {formatBytes(mod.total_bytes, 1)}
                        </span>
                      )}
                  </div>
                </div>
                <div className="shrink-0">
                  <Badge tone={modBadgeTone(mod.state)}>{modBadgeLabel(mod.state)}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function confirmDialog(): React.ReactNode {
    if (!confirm) return null;
    return (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
        onClick={() => setConfirm(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={confirm.title}
          className="w-80 [border-radius:var(--t-radius-confirm)] border border-line bg-surface p-3 [box-shadow:var(--t-shadow-confirm)]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-bold text-ink">{confirm.title}</p>
          <p className="mt-1.5 [font-size:var(--t-type-body-size)] leading-relaxed text-muted2">{confirm.message}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setConfirm(null)}
              className="[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-3 py-1.5 [font-size:var(--t-type-button-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void action();
              }}
              className="[border-radius:var(--t-radius-control)] bg-danger px-3 py-1.5 [font-size:var(--t-type-button-size)] font-bold uppercase tracking-wider [color:var(--t-color-onDanger)] transition-colors hover:brightness-110"
            >
              Unsubscribe
            </button>
          </div>
        </div>
      </div>
    );
  }

  function noticeLine(): React.ReactNode {
    if (!actions.notice) return null;
    return (
      <p
        title={actions.notice.kind === "code" ? NOTICES[actions.notice.code].detail : undefined}
        className={cn(
          "mb-2 cursor-help text-center [font-size:var(--t-type-label-size)]",
          actions.notice.kind === "code" && NOTICES[actions.notice.code].text.startsWith("E")
            ? "text-danger"
            : "text-warn",
        )}
      >
        {actions.notice.kind === "code" ? NOTICES[actions.notice.code].text : actions.notice.text}
      </p>
    );
  }

  function resultLine(): React.ReactNode {
    return (
      <>
        {result?.message && (
          <p className="mt-2 text-center [font-size:var(--t-type-label-size)] text-success">{result.message}</p>
        )}
        {result?.error && (
          <div className="mt-2 rounded-md bg-danger-soft px-3 py-2 ring-1 ring-danger-line">
            <p className="[font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-danger">
              Launch refused
            </p>
            <p className="mt-1 [font-size:var(--t-type-label-size)] leading-relaxed text-ink">{result.error}</p>
          </div>
        )}
      </>
    );
  }

}

function Badge({ tone, children }: { tone: "success" | "danger" | "accent" | "accent2" | "warn" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "success"
      ? "bg-[rgba(77,154,117,0.16)] text-success"
      : tone === "danger"
        ? "bg-danger-soft text-danger"
        : tone === "warn"
          ? "bg-warn-soft text-warn"
          : tone === "accent"
            ? "bg-accent-soft text-accent"
            : tone === "accent2"
              ? "bg-accent2-soft text-accent2"
              : "bg-muted-soft text-muted2";
  return (
    <span className={cn("inline-flex items-center [border-radius:var(--t-radius-badge)] px-1.5 py-px [font-size:var(--t-type-micro-size)] font-bold uppercase tracking-[0.05em] leading-[1.4]", cls)}>
      {children}
    </span>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-surface px-2 py-3.5 text-center">
      <p className={cn("font-mono-data [font-size:var(--t-type-display-size)] font-extrabold leading-none", className)}>{value}</p>
      <p className="mt-1 [font-size:var(--t-type-micro-size)] font-bold uppercase tracking-[0.06em] text-muted">{label}</p>
    </div>
  );
}

function Prop({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 [font-size:var(--t-type-caption-size)] font-bold uppercase tracking-[0.06em] text-muted">{label}</span>
      <span className="min-w-0 truncate font-mono-data [font-size:var(--t-type-data-size)] text-ink">{value}</span>
    </div>
  );
}

function modBadgeTone(state: ModState): "success" | "warn" | "accent" | "danger" | "muted" {
  switch (state) {
    case "ready":
      return "success";
    case "needs_update":
      return "warn";
    case "downloading":
      return "accent";
    case "not_installed":
      return "warn";
    case "not_subscribed":
      return "danger";
    case "not_on_workshop":
      return "muted";
  }
}

function modBadgeLabel(state: ModState): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "needs_update":
      return "Needs update";
    case "downloading":
      return "Downloading";
    case "not_installed":
      return "Not installed";
    case "not_subscribed":
      return "Not subscribed";
    case "not_on_workshop":
      return "Unlisted";
  }
}

function formatModSize(mod: ModReadinessEntry): string {
  if (mod.size_is_upper_bound) {
    return `up to ${formatBytes(mod.size_bytes ?? 0, 1)}`;
  }
  if (mod.state === "ready") {
    return "Ready";
  }
  if (mod.size_bytes == null) {
    return "—";
  }
  return formatBytes(mod.size_bytes, 1);
}

