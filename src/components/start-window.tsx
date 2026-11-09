import { useEffect, useRef, useState } from "react";
import { Check, Clock, LoaderCircle, Play } from "lucide-react";
import { useLaunchStore } from "@/stores/launch-store";
import { useConfirmStore } from "@/stores/confirm-store";
import { useStartWindowStore } from "@/stores/start-window-store";
import { startSteps, noteForStep, type StartStep } from "@/lib/start-steps";
import { useServerActions } from "@/hooks/use-server-actions";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { wrapTabWithin } from "@/theme/interaction/popup-keyboard";

const SLOW_AFTER_MS = 60_000;
const TICK_MS = 1000;

const SLOW_TEXT =
  "This is taking longer than usual. The first start after a DayZ update can take a few minutes. " +
  "Nothing is stuck while the time keeps counting.";

const BUTTON =
  "flex items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

const ICON_TONE: Record<StartStep["state"], string> = {
  done: "text-success",
  now: "text-accent",
  todo: "text-muted",
};

function elapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function StepIcon({ state }: { state: StartStep["state"] }) {
  if (state === "done") return <Check className="size-3.5" aria-hidden />;
  if (state === "now") {
    return <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden />;
  }
  return <Play className="size-3.5" aria-hidden />;
}

// Launcher-owned window, not a registry element — each piece gets a stable
// `data-part` so themes can style it.
export function StartWindow() {
  const op = useLaunchStore((s) => s.op);
  const dayzRunning = useLaunchStore((s) => s.dayzRunning);
  const forOp = useStartWindowStore((s) => s.forOp);
  const toMenu = useStartWindowStore((s) => s.toMenu);
  const hidden = useStartWindowStore((s) => s.hidden);
  const stepSince = useStartWindowStore((s) => s.stepSince);
  const slowSince = useStartWindowStore((s) => s.slowSince);
  // A question such as "mods differ" is asked mid-join and must not sit under this window.
  const asking = useConfirmStore((s) => s.request !== null);
  const noteStep = useStartWindowStore((s) => s.noteStep);
  const hide = useStartWindowStore((s) => s.hide);
  const close = useStartWindowStore((s) => s.close);
  const { cancelWait } = useServerActions();
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());

  const visible =
    op !== null && forOp === op.cancel && !hidden && !asking && !(dayzRunning && op.phase === "starting");
  const steps = op ? startSteps(op, toMenu) : [];
  const index = steps.findIndex((step) => step.state === "now");

  useEscapeLayer(visible, hide);

  // The op ending was this window's own cue to go away.
  useEffect(() => {
    if (forOp === null) return;
    if (op === null || op.cancel !== forOp || (dayzRunning && op.phase === "starting")) close();
  }, [op, forOp, dayzRunning, close]);

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    hideRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [visible]);

  // The clock restarts on a new step, and on the download step whenever its note moves.
  const stepNote = noteForStep(index, op?.note ?? null);
  useEffect(() => {
    if (!visible || index < 0) return;
    noteStep(index, Date.now(), stepNote);
  }, [visible, index, stepNote, noteStep]);

  if (!visible || op === null) return null;

  const starting = op.phase === "launching" || op.phase === "starting";
  const slow = now - slowSince >= SLOW_AFTER_MS;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center [background-color:var(--t-color-scrim)] p-4">
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-window-title"
        onKeyDown={(e) => wrapTabWithin(wrapRef.current, e)}
        className="flex w-[min(440px,100%)] flex-col [border-radius:var(--t-radius-confirm)] border border-line bg-surface [box-shadow:var(--t-shadow-confirm)]"
      >
        <div className="grid gap-0.5 px-4 pt-4">
          <h2
            id="start-window-title"
            data-part="title"
            className="[font-size:var(--t-type-heading-size)] font-semibold leading-5 text-ink"
          >
            Starting DayZ
          </h2>
          <p data-part="server" className="[font-size:var(--t-type-size-sm)] text-muted">
            {op.serverName}
          </p>
        </div>

        <ol data-part="steps" className="m-0 grid list-none gap-1 px-4 py-3">
          {steps.map((step, stepIndex) => (
            <li
              key={stepIndex}
              data-part="step"
              data-state={step.state}
              aria-current={stepIndex === index ? "step" : undefined}
              className="grid grid-cols-[20px_1fr_auto] items-center gap-2.5 [font-size:var(--t-type-body-size)]"
            >
              <span
                data-part="icon"
                className={`grid size-5 place-items-center ${ICON_TONE[step.state]}`}
              >
                <StepIcon state={step.state} />
              </span>
              <span data-part="label" className={step.state === "todo" ? "text-muted" : "text-ink"}>
                {step.label}
              </span>
              <span
                data-part="detail"
                className="flex items-baseline gap-2 font-mono [font-size:var(--t-type-data-size)] text-muted"
              >
                {/* Two elements, not two text nodes: adjacent text merges into one flex item and the gap is lost. */}
                {step.detail && <span>{step.detail}</span>}
                {stepIndex === index && <span>{elapsed(stepSince, now)}</span>}
              </span>
            </li>
          ))}
        </ol>

        {slow && (
          <div
            data-part="slow"
            className="mx-4 mb-3 flex items-start gap-2.5 [border-radius:var(--t-radius-control)] border border-warn-line bg-warn-soft px-3 py-2.5 [font-size:var(--t-type-body-size)] leading-relaxed text-ink"
          >
            <Clock className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
            <span>{SLOW_TEXT}</span>
          </div>
        )}

        <div
          data-part="footer"
          className="flex items-center gap-2 border-t border-line px-4 py-3"
        >
          <span data-part="hint" className="mr-auto [font-size:var(--t-type-caption-size)] text-muted">
            This window closes when DayZ is running.
          </span>
          <button
            type="button"
            data-part="cancel"
            disabled={starting}
            onClick={cancelWait}
            className={BUTTON}
          >
            Cancel
          </button>
          <button ref={hideRef} type="button" data-part="hide" onClick={hide} className={BUTTON}>
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
