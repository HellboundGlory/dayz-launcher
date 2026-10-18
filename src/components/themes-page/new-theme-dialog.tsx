import { useId, useState } from "react";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { wrapTabWithin } from "@/theme/interaction/popup-keyboard";
import type { ThemeSaveResult } from "@/theme/theme-store";
import { INPUT_CLASS } from "./export-theme-dialog";

const NAME_MAX = 64;

const SECONDARY =
  "[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-muted2 transition-colors hover:text-ink";
const PRIMARY =
  "[border-radius:var(--t-radius-control)] bg-accent px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

/** The message a failed save shows, or `null` when it saved. */
export function saveErrorMessage(result: ThemeSaveResult, name: string): string | null {
  if (result === "exists") return `A theme named "${name}" already exists.`;
  if (result === "failed") return "Could not copy the theme.";
  return null;
}

interface NewThemeBoxProps {
  name: string;
  error: string | null;
  pending: boolean;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function NewThemeBox({ name, error, pending, onNameChange, onSubmit, onCancel }: NewThemeBoxProps) {
  const titleId = useId();
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= NAME_MAX;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 [background-color:var(--t-color-scrim)]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => wrapTabWithin(e.currentTarget, e)}
        className="w-[min(360px,100%)] [border-radius:var(--t-radius-confirm)] border border-line bg-surface p-4 [box-shadow:var(--t-shadow-confirm)]"
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !pending) onSubmit();
          }}
        >
          <h2 id={titleId} className="[font-size:var(--t-type-heading-size)] font-semibold leading-5 text-ink">
            New theme
          </h2>
          <div>
            <label className="mb-1.5 block [font-size:var(--t-type-compactCaption-size)] font-bold uppercase tracking-wider text-muted2">
              Name
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          {error && (
            <p role="alert" className="[font-size:var(--t-type-compactCaption-size)] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className={SECONDARY}>
              Cancel
            </button>
            <button type="submit" disabled={!valid || pending} className={PRIMARY}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Asks for a name, then saves a copy of `sourceName` without making it the active theme. */
export function NewThemeDialog({
  sourceName,
  onCreate,
  onClose,
}: {
  sourceName: string;
  onCreate: (name: string) => Promise<ThemeSaveResult>;
  onClose: () => void;
}) {
  const [name, setName] = useState(`Copy of ${sourceName}`);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEscapeLayer(true, onClose);

  async function submit() {
    const trimmed = name.trim();
    setPending(true);
    setError(null);
    const result = await onCreate(trimmed);
    if (result === "saved") {
      onClose();
      return;
    }
    setPending(false);
    setError(saveErrorMessage(result, trimmed));
  }

  return (
    <NewThemeBox
      name={name}
      error={error}
      pending={pending}
      onNameChange={setName}
      onSubmit={() => void submit()}
      onCancel={onClose}
    />
  );
}
