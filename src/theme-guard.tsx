import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
// The only import from `src/theme/` this window is allowed to have: `palette`
// is plain data plus pure colour math with no side effects. Deliberately not
// `theme-store` or `apply` — this window must have no path to the live theming
// engine, since the thing it guards against is a theme that got past it.
import { PRESETS } from "@/theme/palette";

/** Shape returned by the backend while an activation is pending. */
interface ActivationStatus {
  previousId: string | null;
  newId: string | null;
  remainingMs: number;
}

const POLL_MS = 250;

/** Preset ids -> display names, built once from static data. */
const PRESET_NAMES: Record<string, string> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p.name]),
);

/** Display name for a theme id, last resort the raw id itself. */
function nameFor(id: string | null, resolved: Record<string, string>): string {
  if (id === null) return "Default";
  return PRESET_NAMES[id] ?? resolved[id] ?? id;
}

// Theme-guard window's root: polls the backend for the pending activation and
// offers Keep / Revert. Mounted in its own window/bundle (`theme-guard.html`),
// isolated from the launcher UI on purpose, so a hostile theme can't style or
// script the prompt that asks about it.
function ThemeGuardRoot() {
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  // One shot per activation. Keep, an explicit Revert, and the countdown
  // expiring are mutually exclusive, and the poll keeps returning a status for
  // a few frames after whichever one fires (until the backend clears it), so
  // without this a late expiry tick would revert a theme the user just kept.
  // `null` clears it, but so does a countdown restarting upward — a second
  // theme picked before the first window ever read `null` still gets its own
  // guard, which a bare boolean reset on `null` would silently skip.
  const settled = useRef(false);
  const lastRemaining = useRef<number | null>(null);
  // Custom-theme ids already looked up, so `get_theme` fires once per id and
  // not once per 250ms tick.
  const asked = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const next =
          await invoke<ActivationStatus | null>("get_activation_status");
        if (!alive) return;
        const restarted =
          next !== null &&
          lastRemaining.current !== null &&
          next.remainingMs > lastRemaining.current;
        if (next === null || restarted) settled.current = false;
        lastRemaining.current = next?.remainingMs ?? null;
        setStatus(next);
      } catch (e) {
        console.error("theme-guard could not read activation status:", e);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Names for themes that aren't built-in presets arrive after the first paint;
  // the countdown shows the raw id until then rather than waiting on the lookup.
  useEffect(() => {
    if (status === null) return;
    for (const id of [status.previousId, status.newId]) {
      if (id === null || asked.current.has(id)) continue;
      if (PRESET_NAMES[id] !== undefined) continue;
      asked.current.add(id);
      void invoke<{ name: string } | null>("get_theme", { id }).then(
        (theme) => {
          if (theme?.name) setNames((prev) => ({ ...prev, [id]: theme.name }));
        },
        (e) => console.error(`theme-guard could not resolve theme "${id}":`, e),
      );
    }
  }, [status]);

  const keep = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    void invoke("confirm_activation").catch((e) =>
      console.error("theme-guard could not confirm activation:", e),
    );
  }, []);

  const revert = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    void invoke("revert_activation").catch((e) =>
      console.error("theme-guard could not revert activation:", e),
    );
  }, []);

  // Countdown expiry and "Revert now" are the same action, same command.
  useEffect(() => {
    if (status !== null && status.remainingMs <= 0) revert();
  }, [status, revert]);

  // Hidden state: the backend hides the window with no activation pending, so
  // there is nothing to paint.
  if (status === null) return null;

  const seconds = Math.ceil(status.remainingMs / 1000);

  return (
    <div className="tg-panel">
      <p className="tg-prompt">
        {`Keep "${nameFor(status.newId, names)}"? Reverting to "${nameFor(status.previousId, names)}" in ${seconds}s.`}
      </p>
      <div className="tg-actions">
        <button type="button" className="tg-btn tg-btn-keep" onClick={keep}>
          Keep
        </button>
        <button type="button" className="tg-btn tg-btn-revert" onClick={revert}>
          Revert now
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("theme-guard-root")!).render(
  <ThemeGuardRoot />,
);
