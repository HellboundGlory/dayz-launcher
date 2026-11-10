import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { memoryMapCommands } from "@/lib/memory-map-gate";
import { useMemoryMapStore } from "@/stores/memory-map-store";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { DialogFrame } from "@/components/dialog-frame";

// Launcher-owned dialog, not a registry element: no `data-el`, but every piece
// carries a `data-part` so themes can style it.
const BUTTON =
  "flex items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold text-ink transition-colors hover:border-accent-line";

const COPY_LABELS = [
  "Copy the command that raises the limit until the next restart",
  "Copy the command that keeps the limit after restarts",
];

export function MemoryMapDialog() {
  const request = useMemoryMapStore((s) => s.request);
  const answer = useMemoryMapStore((s) => s.answer);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [dontWarn, setDontWarn] = useState(false);
  const [copyState, setCopyState] = useState<{ index: number; state: "copied" | "failed" } | null>(null);

  useEffect(() => {
    if (!request) return;
    setDontWarn(false);
    setCopyState(null);
    cancelRef.current?.focus();
  }, [request]);

  useEffect(() => {
    if (copyState?.state !== "copied") return;
    const index = copyState.index;
    const timer = setTimeout(() => {
      setCopyState((current) => (current?.index === index ? null : current));
    }, 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  useEscapeLayer(!!request, () => answer(false, dontWarn));

  if (!request) return null;

  const { current, recommended } = request.status;
  const { raise, keep } = memoryMapCommands(recommended);

  const copy = async (index: number, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState({ index, state: "copied" });
    } catch {
      setCopyState({ index, state: "failed" });
    }
  };

  const blocks = [
    { label: "Raise it until the next restart", command: raise },
    { label: "Keep it after restarts", command: keep },
  ];

  return (
    <DialogFrame
      labelledBy="memory-map-title"
      className="flex w-[min(540px,100%)] flex-col"
    >
      <div className="grid gap-0.5 px-4 pt-4">
        <h2
          id="memory-map-title"
          data-part="title"
          className="[font-size:var(--t-type-heading-size)] font-semibold leading-5 text-ink"
        >
          DayZ may crash on this system
        </h2>
        <p data-part="sub" className="[font-size:var(--t-type-size-sm)] text-muted">
          Linux memory map limit
        </p>
      </div>

      <div className="grid gap-3 px-4 py-3.5">
        <p data-part="message" className="[font-size:var(--t-type-body-size)] leading-relaxed text-muted2">
          Linux limits how many memory areas one program can map. Yours allows{" "}
          <b className="font-mono tabular-nums text-ink">{current}</b>; DayZ needs at least{" "}
          <b className="font-mono tabular-nums text-ink">{recommended}</b> and can crash without
          warning below that.
        </p>

        {blocks.map((block, index) => (
          <div key={block.command} className="grid gap-1">
            <span className="[font-size:var(--t-type-label-size)] font-semibold text-ink">
              {block.label}
            </span>
            <div className="flex items-start gap-2">
              <code
                data-part="command"
                className="min-w-0 flex-1 whitespace-pre-wrap break-all [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] font-mono [font-size:var(--t-type-data-size)] leading-relaxed text-ink"
              >
                {block.command}
              </code>
              <button
                type="button"
                data-part="copy"
                aria-label={COPY_LABELS[index]}
                onClick={() => void copy(index, block.command)}
                className={BUTTON}
              >
                <Copy className="size-3.5" />
                {copyState?.index === index
                  ? copyState.state === "copied"
                    ? "Copied"
                    : "Copy failed"
                  : "Copy"}
              </button>
            </div>
          </div>
        ))}

        <label data-part="dontWarn" className="flex cursor-pointer items-center gap-2 py-1">
          <input
            type="checkbox"
            checked={dontWarn}
            onChange={(e) => setDontWarn(e.target.checked)}
            className="size-3.5 shrink-0 accent-accent"
          />
          <span className="[font-size:var(--t-type-body-size)] text-ink">Don't warn me again</span>
        </label>
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        <button
          ref={cancelRef}
          type="button"
          data-part="cancel"
          onClick={() => answer(false, dontWarn)}
          className={BUTTON}
        >
          Close
        </button>
        <button type="button" data-part="join" onClick={() => answer(true, dontWarn)} className={BUTTON}>
          Join anyway
        </button>
      </div>
    </DialogFrame>
  );
}
