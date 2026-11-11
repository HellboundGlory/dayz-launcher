import { Eye, EyeOff, Lock, Play } from "lucide-react";
import { usePasswordStore } from "@/stores/password-store";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { DialogFrame } from "@/components/dialog-frame";

// Launcher-owned password dialog, not a registry element — each piece gets a
// stable `data-part` so themes can style it.
export function PasswordDialog() {
  const request = usePasswordStore((s) => s.request);
  const draft = usePasswordStore((s) => s.draft);
  const remember = usePasswordStore((s) => s.remember);
  const reveal = usePasswordStore((s) => s.reveal);
  const setDraft = usePasswordStore((s) => s.setDraft);
  const setRemember = usePasswordStore((s) => s.setRemember);
  const toggleReveal = usePasswordStore((s) => s.toggleReveal);
  const submit = usePasswordStore((s) => s.submit);
  const cancel = usePasswordStore((s) => s.cancel);

  useEscapeLayer(!!request, cancel);

  if (!request) return null;

  return (
    <DialogFrame label="Server password" onBackdropClick={cancel} className="w-[400px] p-3">
      <form
        data-part="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p
          data-part="title"
          className="flex items-center gap-1.5 [font-size:var(--t-type-subheading-size)] font-bold leading-4 text-ink"
        >
          <Lock size={15} className="shrink-0 text-muted2" aria-hidden />
          Server password
        </p>
        <p data-part="server" className="mt-1 [font-size:var(--t-type-body-size)] leading-relaxed text-muted2">
          {request.serverName}
        </p>

        <label
          htmlFor="password-field"
          className="[font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2"
        >
          Password
        </label>
        <div className="mt-1 flex items-center gap-1 [border-radius:var(--t-radius-control)] border border-line bg-bg px-2">
          <input
            id="password-field"
            data-part="password"
            type={reveal ? "text" : "password"}
            autoFocus
            autoComplete="off"
            maxLength={256}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-w-0 flex-1 bg-transparent py-1.5 [font-size:var(--t-type-body-size)] text-ink outline-none"
          />
          <button
            data-part="reveal"
            type="button"
            aria-label={reveal ? "Hide password" : "Show password"}
            title={reveal ? "Hide password" : "Show password"}
            aria-pressed={reveal}
            onClick={toggleReveal}
            className="shrink-0 p-1 text-muted2 transition-colors hover:text-ink"
          >
            {reveal ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </button>
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2">
          <input
            data-part="remember"
            type="checkbox"
            checked={remember && request.keyring}
            disabled={!request.keyring}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-accent disabled:cursor-not-allowed"
          />
          <span className="min-w-0">
            <span className="block [font-size:var(--t-type-body-size)] text-ink">
              Remember for this server
            </span>
            <span data-part="remember-note" className="block [font-size:var(--t-type-caption-size)] text-muted2">
              {request.keyring
                ? "Saved in your system keyring, never in Tetra's own files."
                : "No system keyring found, so Tetra can't remember it. You'll be asked each time."}
            </span>
          </span>
        </label>

        <div className="mt-3 flex justify-end gap-2">
          <button
            data-part="cancel"
            type="button"
            onClick={cancel}
            className="[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            data-part="confirm"
            type="submit"
            disabled={!draft}
            className="flex items-center gap-1.5 [border-radius:var(--t-radius-control)] bg-accent px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider [color:var(--t-color-onAccent)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
          >
            <Play size={13} aria-hidden />
            Join
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
