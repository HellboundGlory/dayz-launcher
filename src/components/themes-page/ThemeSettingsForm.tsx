import { useRef, useState } from "react";
import { useThemeStore } from "@/theme/theme-store";
import type { SettingsField } from "@/theme/settings-schema";

const COMMIT_DELAY_MS = 350;

export type CommitTimers = Record<string, number | ReturnType<typeof setTimeout> | undefined>;

export function stepFor(min: number, max: number): number {
  const span = max - min;
  if (span <= 1) return 0.01;
  if (span <= 10) return 0.1;
  return 1;
}

export function scheduleCommit(timers: CommitTimers, fieldId: string, commit: () => void): void {
  clearTimeout(timers[fieldId]);
  timers[fieldId] = setTimeout(() => {
    delete timers[fieldId];
    commit();
  }, COMMIT_DELAY_MS);
}

export function ThemeSettingsForm({ id, fields }: { id: string; fields: SettingsField[] }) {
  const values = useThemeStore((s) => s.settingsValues[id]);
  const setSettingsValue = useThemeStore((s) => s.setSettingsValue);
  const [dragged, setDragged] = useState<{ id: string; byField: Record<string, number> }>({
    id,
    byField: {},
  });
  const shown = dragged.id === id ? dragged.byField : {};
  const timers = useRef<CommitTimers>({});

  function current(field: SettingsField): string | number | boolean {
    if (field.type === "number" && shown[field.id] !== undefined) return shown[field.id]!;
    const cached = values?.[field.id];
    if (field.type === "number" && typeof cached === "number") return cached;
    if (field.type === "boolean" && typeof cached === "boolean") return cached;
    if ((field.type === "choice" || field.type === "color") && typeof cached === "string") return cached;
    return field.default;
  }

  return (
    <div className="flex flex-col gap-1.5 [border-radius:var(--t-radius-card)] border border-line bg-surface2 p-2.5">
      {fields.map((field) => {
        if (field.type === "number") {
          return (
            <div
              key={field.id}
              className="flex items-center gap-2 [border-radius:var(--t-radius-popup)] border border-line bg-bg px-2.5 py-[7px]"
            >
              <label
                htmlFor={`theme-setting-${field.id}`}
                title={field.label}
                className="w-[92px] shrink-0 truncate [font-size:var(--t-type-caption-size)] font-semibold text-ink"
              >
                {field.label}
              </label>
              <input
                id={`theme-setting-${field.id}`}
                type="range"
                min={field.min}
                max={field.max}
                step={field.step ?? stepFor(field.min, field.max)}
                value={current(field) as number}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setDragged((prev) => ({
                    id,
                    byField: { ...(prev.id === id ? prev.byField : {}), [field.id]: next },
                  }));
                  scheduleCommit(timers.current, field.id, () => {
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
              <output className="w-[40px] shrink-0 text-right font-mono-data [font-size:var(--t-type-caption-size)] text-accent">
                {current(field) as number}
              </output>
            </div>
          );
        }

        if (field.type === "boolean") {
          return (
            <label key={field.id} className="flex cursor-pointer items-start gap-2 py-1.5">
              <input
                type="checkbox"
                checked={current(field) as boolean}
                onChange={(e) => void setSettingsValue(id, field.id, e.target.checked)}
                className="mt-0.5 size-3.5 shrink-0 accent-accent"
              />
              <span className="min-w-0 [font-size:var(--t-type-body-size)] text-ink">{field.label}</span>
            </label>
          );
        }

        if (field.type === "choice") {
          return (
            <div
              key={field.id}
              className="flex items-center gap-2 [border-radius:var(--t-radius-popup)] border border-line bg-bg px-2.5 py-[7px]"
            >
              <label
                htmlFor={`theme-setting-${field.id}`}
                title={field.label}
                className="w-[92px] shrink-0 truncate [font-size:var(--t-type-caption-size)] font-semibold text-ink"
              >
                {field.label}
              </label>
              <select
                id={`theme-setting-${field.id}`}
                value={current(field) as string}
                onChange={(e) => void setSettingsValue(id, field.id, e.target.value)}
                className="flex-1 rounded border border-line bg-surface px-2 py-1 [font-size:var(--t-type-body-size)] text-ink accent-accent"
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (field.type === "color") {
          const val = current(field) as string;
          return (
            <div
              key={field.id}
              className="flex items-center gap-2 [border-radius:var(--t-radius-popup)] border border-line bg-bg px-2.5 py-[7px]"
            >
              <label
                htmlFor={`theme-setting-${field.id}`}
                title={field.label}
                className="w-[92px] shrink-0 truncate [font-size:var(--t-type-caption-size)] font-semibold text-ink"
              >
                {field.label}
              </label>
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="color"
                  id={`theme-setting-${field.id}`}
                  value={val}
                  onChange={(e) => void setSettingsValue(id, field.id, e.target.value)}
                  className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={val}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (/^#[0-9a-fA-F]{6}$/.test(next)) {
                      void setSettingsValue(id, field.id, next);
                    }
                  }}
                  className="w-24 rounded border border-line bg-surface px-2 py-1 font-mono-data [font-size:var(--t-type-caption-size)] text-ink"
                />
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
