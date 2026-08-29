import { useEffect, useRef, useState } from "react";
import { X, Play, Download, ChevronDown, Loader2, Check, ListTree } from "lucide-react";
import type { Server } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { cn, formatGameTime, regionName } from "@/lib/utils";
import { useServerActions, NOTICES } from "@/hooks/use-server-actions";

interface ServerInfoModalProps {
  server: Server;
  onClose: () => void;
}

/**
 * M1 — the "More info" modal. Opened from the D2 row ⋯ menu. 430px dialog with
 * identity + badges, a 3-stat band, mod-readiness line, props and the
 * JOIN / Load actions. Focus is trapped; Escape, ✕ and backdrop click close.
 */
export function ServerInfoModal({ server, onClose }: ServerInfoModalProps) {
  const actions = useServerActions();
  const modPending = useServerStore((s) => s.modPending);
  const [loadOpen, setLoadOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const joinRef = useRef<HTMLButtonElement>(null);
  const loadMenuRef = useRef<HTMLDivElement>(null);
  const loadToggleRef = useRef<HTMLButtonElement>(null);

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

  function closeIfOutside(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="ovl absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,13,0.7)]"
      onMouseDown={closeIfOutside}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Server info: ${server.name || server.addr}`}
        onKeyDown={trapTab}
        className="modal w-[min(430px,calc(100%-40px))] overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
      >
        <div className="modal-wrap relative">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-2.5 z-[2] text-muted transition-colors hover:text-ink"
          >
            <X className="size-4" />
          </button>

          <div className="m-identity p-3.5">
            <h2 className="text-[14px] font-bold leading-snug text-ink">
              {server.name || server.addr}
            </h2>
            <p className="mt-0.5 font-mono-data text-[10px] text-muted">
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

          <div className="m-band grid grid-cols-3 gap-px border-b border-line bg-line">
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

          <div className="flex items-center gap-1.5 border-b border-line px-3.5 py-2 text-[10px] text-muted">
            <span
              className={cn(
                "inline-block h-[7px] w-[7px] rounded-full",
                readiness.tone === "warn"
                  ? "bg-warn shadow-[0_0_5px_rgba(193,154,85,0.6)]"
                  : "bg-success shadow-[0_0_5px_rgba(77,154,117,0.6)]",
              )}
            />
            {readiness.text}
          </div>

          <div className="m-props px-3.5 py-2">
            <Prop label="Map" value={server.map_display || "—"} />
            <Prop label="Version" value={server.version || "unknown"} />
            <Prop label="Region" value={regionName(server.country_code)} />
            <Prop label="Mods" value={server.mod_count != null ? String(server.mod_count) : server.modded ? "?" : "0"} />
          </div>

          <div className="m-actions border-t border-line px-3.5 pb-3.5 pt-2.5">
            {actions.notice && (
              <p
                title={
                  actions.notice.kind === "code"
                    ? NOTICES[actions.notice.code].detail
                    : undefined
                }
                className={cn(
                  "mb-2 cursor-help text-center text-[10px]",
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
            )}

            {busy ? (
              <div className="flex gap-1.5">
                <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-surface2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-accent ring-1 ring-accent-line">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  <span className="truncate">{actions.phaseLabel(actions.op!)}</span>
                </div>
                {actions.op!.phase !== "launching" && actions.op!.phase !== "starting" && (
                  <button
                    onClick={actions.cancelWait}
                    className="shrink-0 rounded-[6px] bg-surface2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted2 ring-1 ring-line transition-colors hover:text-danger"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ) : actions.dayzUp ? (
              <button
                disabled
                title="DayZ is running. Quit the game before joining another server."
                className="flex w-full items-center justify-center gap-1.5 rounded-[6px] bg-success px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[#10131a]"
              >
                <Check className="size-3.5" />
                <span>PLAYING</span>
              </button>
            ) : (
              <div className="relative flex w-full gap-1">
                <button
                  ref={joinRef}
                  onClick={() => void actions.verifyAndJoin(server, false)}
                  className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-accent px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110"
                >
                  {server.modded ? <Download className="size-3.5" /> : <Play className="size-3.5" />}
                  <span>Join</span>
                </button>
                <button
                  ref={loadToggleRef}
                  onClick={() => setLoadOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={loadOpen}
                  title="Load this server's mods to the main menu"
                  className="flex shrink-0 items-center justify-center rounded-[6px] bg-accent px-2 text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110"
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", loadOpen && "rotate-180")} />
                </button>

                {loadOpen && (
                  <div
                    ref={loadMenuRef}
                    role="menu"
                    // Opens upward (`bottom-full`), not down from the button
                    // (`top-...`): this row is the last thing in the modal,
                    // and the modal's own `overflow-hidden` (for its rounded
                    // corners) clipped a downward-opening menu right at the
                    // bottom edge. Same fix `mods-tab.tsx`'s action-bar
                    // dropdowns already use for the identical bottom-row
                    // shape.
                    className="absolute bottom-full right-0 z-[6] mb-1 w-56 rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        setLoadOpen(false);
                        void actions.verifyAndJoin(server, true);
                      }}
                      title="Verify the mod list, then launch DayZ to the main menu with this server's mods loaded — it does not join the server."
                      className="flex w-full items-center gap-2 rounded-[5px] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink transition-colors hover:bg-accent-soft hover:text-accent"
                    >
                      <ListTree className="size-3.5 text-muted2" />
                      <span>Load</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {result?.message && (
              <p className="mt-2 text-center text-[10px] text-success">{result.message}</p>
            )}
            {result?.error && (
              <div className="mt-2 rounded-md bg-danger-soft px-3 py-2 ring-1 ring-danger-line">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-danger">
                  Launch refused
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink">{result.error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "success" | "danger" | "accent" | "accent2" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "success"
      ? "bg-[rgba(77,154,117,0.16)] text-success"
      : tone === "danger"
        ? "bg-danger-soft text-danger"
        : tone === "accent"
          ? "bg-accent-soft text-accent"
          : tone === "accent2"
            ? "bg-accent2-soft text-accent2"
            : "bg-muted-soft text-muted2";
  return (
    <span className={cn("inline-flex items-center rounded-[3px] px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.05em] leading-[1.4]", cls)}>
      {children}
    </span>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-surface px-2 py-3.5 text-center">
      <p className={cn("font-mono-data text-[22px] font-extrabold leading-none", className)}>{value}</p>
      <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.06em] text-muted">{label}</p>
    </div>
  );
}

function Prop({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.06em] text-muted">{label}</span>
      <span className="min-w-0 truncate font-mono-data text-[10px] text-ink">{value}</span>
    </div>
  );
}
