import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
// The only import from src/theme/ this window may have: palette is pure data
// with no side effects. Never theme-store or apply — no path to the live engine.
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

// Polls the backend for the pending activation and offers Keep/Revert. Its
// own window/bundle, isolated so a hostile theme can't style or script it.
function ThemeGuardRoot() {
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  // Guards against a late poll tick (status not yet cleared to null) reverting
  // a theme just kept. A restarting countdown also resets it, so a second
  // activation before the window reads null still gets its own guard.
  const settled = useRef(false);
  const lastRemaining = useRef<number | null>(null);
  // So get_theme fires once per id, not once per poll tick.
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

  // Non-preset names resolve after first paint; the countdown shows the raw id until then.
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

  if (status === null) return null;

  const seconds = Math.ceil(status.remainingMs / 1000);
  // A layout edit arms both ids the same, where the switch wording would read
  // "Keep X? Reverting to X".
  const name = nameFor(status.newId, names);
  const prompt =
    status.previousId === status.newId
      ? `Keep this layout change to "${name}"? Reverting in ${seconds}s.`
      : `Keep "${name}"? Reverting to "${nameFor(status.previousId, names)}" in ${seconds}s.`;

  return (
    <div className="tg-panel">
      <p className="tg-prompt">{prompt}</p>
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
