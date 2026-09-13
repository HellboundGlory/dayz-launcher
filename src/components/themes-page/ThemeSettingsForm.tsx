import { useRef, useState } from "react";
import { useThemeStore } from "@/theme/theme-store";
import type { SettingsField } from "@/theme/settings-schema";

// A slider drag fires per pixel and each write behind it is a disk IPC call,
// so a number field waits this long for the drag to settle. A toggle is one
// discrete event and needs none of this.
const COMMIT_DELAY_MS = 350;

/** Pending writes by field id. Per field rather than one shared timer:
 * dragging a second slider must not cancel the first slider's write. */
export type CommitTimers = Record<string, number | undefined>;

/**
 * A slider's granularity: the schema declares only `min`/`max`, and the
 * browser's default `step` of 1 would snap a fractional span (0..1) to its
 * ends while the readout still showed the unsnapped value.
 */
export function stepFor(min: number, max: number): number {
  const span = max - min;
  if (span <= 1) return 0.01;
  if (span <= 10) return 0.1;
  return 1;
}

/** Cancel this field's pending write and arm `commit` again from now — the
 * debounce itself. Exported as its own test seam; the form is its only caller. */
export function scheduleCommit(timers: CommitTimers, fieldId: string, commit: () => void): void {
  clearTimeout(timers[fieldId]);
  timers[fieldId] = setTimeout(() => {
    delete timers[fieldId];
    commit();
  }, COMMIT_DELAY_MS);
}

/**
 * One control per field of the active installed theme's own
 * `settings.schema.json`. Values come from the store's `settingsValues` cache,
 * which `hydrate`/`pickTheme` fill with every field already merged over its
 * schema default — so a field nothing has tuned reads as its default.
 */
export function ThemeSettingsForm({ id, fields }: { id: string; fields: SettingsField[] }) {
  const values = useThemeStore((s) => s.settingsValues[id]);
  const setSettingsValue = useThemeStore((s) => s.setSettingsValue);
  /**
   * What a slider is showing mid-drag: a drag has to feel immediate, but the
   * write behind it is debounced, so the store would otherwise lag the thumb.
   * The theme id rides along, so nothing left in flight by the previous theme
   * paints over this one's field of the same name.
   */
  const [dragged, setDragged] = useState<{ id: string; byField: Record<string, number> }>({
    id,
    byField: {},
  });
  const shown = dragged.id === id ? dragged.byField : {};
  const timers = useRef<CommitTimers>({});

  /** A field's live value: the in-flight drag, then the cache, then its default. */
  function current(field: SettingsField): number | boolean {
    if (field.type === "number" && shown[field.id] !== undefined) return shown[field.id]!;
    const cached = values?.[field.id];
    return typeof cached === "number" || typeof cached === "boolean" ? cached : field.default;
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[8px] border border-line bg-surface2 p-2.5">
      {fields.map((field) =>
        field.type === "number" ? (
          <div
            key={field.id}
            className="flex items-center gap-2 rounded-[7px] border border-line bg-bg px-2.5 py-[7px]"
          >
            <label
              htmlFor={`theme-setting-${field.id}`}
              title={field.label}
              className="w-[92px] shrink-0 truncate text-[9px] font-semibold text-ink"
            >
              {field.label}
            </label>
            <input
              id={`theme-setting-${field.id}`}
              type="range"
              min={field.min}
              max={field.max}
              step={stepFor(field.min, field.max)}
              value={current(field) as number}
              onChange={(e) => {
                const next = Number(e.target.value);
                // The thumb moves now; the write waits for the drag to settle.
                setDragged((prev) => ({
                  id,
                  byField: { ...(prev.id === id ? prev.byField : {}), [field.id]: next },
                }));
                scheduleCommit(timers.current, field.id, () => {
                  // Once the write lands the store owns this field's value, so
                  // the drag overlay has nothing left to say — and a write that
                  // failed falls back to showing what really persisted. Only
                  // cleared if the thumb has not moved on since.
                  void setSettingsValue(id, field.id, next).then(() => {
                    setDragged((prev) => {
                      if (prev.id !== id || prev.byField[field.id] !== next) return prev;
                      const byField = { ...prev.byField };
                      delete byField[field.id];
                      return { id, byField };
                    });
                  });
                });
              }}
              className="h-[3px] flex-1 accent-accent"
            />
            <output className="w-[40px] shrink-0 text-right font-mono-data text-[9px] text-accent">
              {current(field) as number}
            </output>
          </div>
        ) : (
          <label key={field.id} className="flex cursor-pointer items-start gap-2 py-1.5">
            <input
              type="checkbox"
              checked={current(field) as boolean}
              onChange={(e) => void setSettingsValue(id, field.id, e.target.checked)}
              className="mt-0.5 size-3.5 shrink-0 accent-accent"
            />
            <span className="min-w-0 text-[11px] text-ink">{field.label}</span>
          </label>
        ),
      )}
    </div>
  );
}
