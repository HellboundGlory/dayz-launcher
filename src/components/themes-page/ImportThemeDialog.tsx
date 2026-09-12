import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FileArchive, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { confirmThemeInstall, importThemePreview } from "@/lib/tauri";
import type { ThemeImportPreview, ThemeManifest, ThemeSummary } from "@/types/theme";

interface ImportThemeDialogProps {
  /** Consulted for the currently-installed version behind an update/downgrade/same_version message. */
  installedThemes: ThemeSummary[];
  /** Called once, after the install confirmed — the caller decides what happens next. */
  onInstalled: (id: string) => void;
  onClose: () => void;
}

type Phase = "idle" | "loading" | "preview" | "error" | "installing";

/** `ThemeImportPreview.classification` is a bare string on the wire; these are the four the backend emits. */
type Classification = "new" | "update" | "same_version" | "downgrade";

/** The wire field is a loose `string`; anything unrecognised is treated as a first install. */
function isClassification(raw: string): raw is Classification {
  return (
    raw === "new" || raw === "update" || raw === "same_version" || raw === "downgrade"
  );
}

/** A Tauri rejection arrives as a plain string; the two Error shapes are for anything thrown here. */
function rejectionText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "The import failed.";
}

/** The Step 2 sentence and button label, both keyed on what installing would do. */
function installCopy(
  classification: Classification,
  manifest: ThemeManifest,
  oldVersion: string | undefined,
): { line: string; action: string } {
  switch (classification) {
    case "update":
      return {
        line: `Installed: v${oldVersion ?? "?"} → Update to v${manifest.version}`,
        action: "Update",
      };
    case "same_version":
      return { line: "Already installed — reinstall?", action: "Reinstall" };
    case "downgrade":
      return {
        line: `This is an older version (${manifest.version}) than the one installed (${oldVersion ?? "?"}) — install anyway?`,
        action: "Install anyway",
      };
    default:
      return { line: `${manifest.id} is not installed yet.`, action: "Install" };
  }
}

// Import a theme package: pick a .zip, review what the backend's validation
// made of it, then install it. Two IPC calls, both below. Focus trapped;
// Escape, ✕ and backdrop click close.
export function ImportThemeDialog({
  installedThemes,
  onInstalled,
  onClose,
}: ImportThemeDialogProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<ThemeImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const installRef = useRef<HTMLButtonElement>(null);

  const busy = phase === "installing";

  useEffect(() => {
    chooseRef.current?.focus();
  }, []);

  useEffect(() => {
    if (phase === "preview") installRef.current?.focus();
  }, [phase]);

  // The install step consumes the staging directory on the backend; closing
  // mid-flight would strand the result, so every dismiss path goes through here.
  function close() {
    if (!busy) onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  /** Tab wraps within the dialog; Shift+Tab goes backwards. */
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

  async function chooseFile() {
    let selected: unknown;
    try {
      selected = await open({ filters: [{ name: "Tetra Theme", extensions: ["zip"] }] });
    } catch {
      // User cancelled the dialog, or the platform has no native picker — ignore.
      return;
    }
    if (typeof selected !== "string") return;

    setPreview(null);
    setError(null);
    setPhase("loading");
    try {
      const next = await importThemePreview(selected);
      setPreview(next);
      setPhase("preview");
    } catch (e) {
      setError(rejectionText(e));
      setPhase("error");
    }
  }

  async function install() {
    if (!preview) return;
    setError(null);
    setPhase("installing");
    try {
      const id = await confirmThemeInstall(preview.stagingId);
      onInstalled(id);
    } catch (e) {
      setError(rejectionText(e));
      setPhase("error");
    }
  }

  const manifest = preview?.manifest ?? null;
  const copy =
    manifest && preview
      ? installCopy(
          isClassification(preview.classification) ? preview.classification : "new",
          manifest,
          installedThemes.find((t) => t.id === manifest.id)?.version,
        )
      : null;
  const showPreview =
    preview !== null &&
    manifest !== null &&
    copy !== null &&
    (phase === "preview" || phase === "installing");

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,13,0.7)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label={manifest ? `Import theme: ${manifest.name}` : "Import theme"}
        onKeyDown={trapTab}
        className="max-h-[calc(100%-40px)] w-[min(430px,calc(100%-40px))] overflow-y-auto rounded-[10px] border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13.5px] font-bold text-ink">
              {manifest ? `Import Theme: ${manifest.name}` : "Import Theme"}
            </h2>
            <p className="mt-0.5 text-[10px] text-muted">
              {manifest
                ? "Review the package before installing it"
                : "Pick a Tetra theme package (.zip)"}
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="shrink-0 text-muted transition-colors hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {/* The error state offers only Cancel — the rejection message owns the body. */}
          {phase !== "error" && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-[9.5px] font-bold uppercase tracking-wider text-muted2">Step 1</h3>
              <div className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-line bg-surface2 px-4 py-5 text-center">
                <FileArchive className="size-5 text-muted" />
                <p className="text-[10.5px] text-muted">Drag a .zip here</p>
                <p className="text-[9.5px] uppercase tracking-wider text-muted-soft">or</p>
                <button
                  ref={chooseRef}
                  onClick={() => void chooseFile()}
                  disabled={phase === "loading" || busy}
                  className="flex items-center gap-1.5 rounded-[6px] border border-line bg-surface px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink transition-colors duration-150 hover:border-accent-line hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase === "loading" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FileArchive className="size-3.5" />
                  )}
                  <span>Choose File…</span>
                </button>
              </div>
            </section>
          )}

          {phase === "loading" && (
            <div className="flex items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface2 px-3 py-4 text-[10.5px] text-accent">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span>Validating package…</span>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col gap-2.5">
              <div className="rounded-[8px] border border-danger-line bg-danger-soft px-3 py-2.5 text-[10.5px] leading-relaxed text-danger">
                <p className="font-bold uppercase tracking-wider">Import failed</p>
                <p className="mt-1 break-words">{error}</p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={close}
                  className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted2 transition-colors duration-150 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showPreview && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-[9.5px] font-bold uppercase tracking-wider text-muted2">
                Step 2
              </h3>
              <div className="flex flex-col gap-3 rounded-[8px] border border-line bg-surface2 p-3.5">
                <div>
                  <p className="text-[12.5px] font-bold text-ink">{manifest.name}</p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    by {manifest.author} · <span className="font-mono-data">v{manifest.version}</span>
                  </p>
                  {manifest.description && (
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted2">
                      “{manifest.description}”
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-[9.5px] font-bold uppercase tracking-wider text-muted2">
                    Compatibility
                  </h4>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    <li className="flex items-center gap-1.5 text-[10.5px] text-muted2">
                      <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                      <span>
                        Theme API <span className="font-mono-data">{manifest.themeApi}</span>
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5 text-[10.5px] text-muted2">
                      <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                      <span>
                        Requires Tetra Launcher ≥{" "}
                        <span className="font-mono-data">{manifest.minimumLauncherVersion}</span>
                      </span>
                    </li>
                  </ul>
                </div>

                <p className="text-[10px] text-muted">
                  Tier <span className="font-mono-data text-muted2">{manifest.tier}</span>
                  {" · "}
                  <span className="font-mono-data text-muted2">
                    {(preview.packageSizeBytes / 1_048_576).toFixed(1)} MB
                  </span>
                  {" · "}
                  <span className="font-mono-data text-muted2">{preview.fileCount} files</span>
                </p>

                <p className="text-[10.5px] leading-relaxed text-ink">{copy.line}</p>

                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={close}
                    disabled={busy}
                    className="rounded-[6px] border border-line bg-surface px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted2 transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    ref={installRef}
                    onClick={() => void install()}
                    disabled={busy}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[6px] bg-accent px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110",
                      "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:brightness-100",
                    )}
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    <span>{busy ? "Installing…" : copy.action}</span>
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
