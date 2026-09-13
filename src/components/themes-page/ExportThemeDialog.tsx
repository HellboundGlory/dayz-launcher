import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { exportTheme, getTheme } from "@/lib/tauri";
import { resolvedPair } from "@/theme/theme-store";
import type { ManifestOverrides, ThemeFile } from "@/types/theme";

interface ExportThemeDialogProps {
  id: string;
  /** Called once, after `exportTheme` resolves. */
  onExported: () => void;
  /** Cancel, Escape, or backdrop click. */
  onClose: () => void;
}

/** Shared text-input styling (board `.field input`). */
const INPUT_CLASS =
  "w-full rounded-[6px] border border-line bg-bg px-2.5 py-2 text-[11.5px] text-ink placeholder-muted outline-none transition-colors duration-150 hover:border-line-weak focus:border-accent-line";

/** The four tokens the read-only swatch strip shows: background, raised surface, and the two accents. */
const SWATCH_TOKENS = ["bg", "surface2", "accent", "accent2"] as const;

// "Export Theme" dialog: the export-time manifest override form, prefilled
// from `id`'s installed theme.json. Focus trapped; Escape, ✕ and backdrop
// click close, same contract as ServerInfoModal.
export function ExportThemeDialog({
  id,
  onExported,
  onClose,
}: ExportThemeDialogProps): JSX.Element {
  const [theme, setTheme] = useState<ThemeFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [license, setLicense] = useState("");
  const [homepage, setHomepage] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getTheme(id)
      .then((file) => {
        if (cancelled) return;
        setTheme(file);
        setName(file.name);
        setAuthor(file.author);
        setVersion(file.version);
        setDescription(file.description);
        setLicense(file.license ?? "");
        setHomepage(file.homepage ?? "");
        setTags(file.tags);
        nameRef.current?.focus();
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  function closeIfOutside(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function addTags(raw: string[]) {
    const next = raw.map((t) => t.trim()).filter(Boolean);
    if (next.length === 0) return;
    setTags((cur) => {
      const out = [...cur];
      for (const t of next) if (!out.includes(t)) out.push(t);
      return out;
    });
  }

  // A comma commits everything before it, so pasting "dark, compact" works.
  function onTagTyping(value: string) {
    if (!value.includes(",")) {
      setTagInput(value);
      return;
    }
    const parts = value.split(",");
    setTagInput(parts.pop() ?? "");
    addTags(parts);
  }

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const dest = await save({
        defaultPath: `${id}.zip`,
        filters: [{ name: "Tetra Theme", extensions: ["zip"] }],
      });
      if (typeof dest !== "string") return;

      const overrides: ManifestOverrides = {
        name: name.trim(),
        author: author.trim(),
        version: version.trim(),
        description: description.trim(),
        tags,
      };
      // Omitted rather than sent empty: the backend treats an absent key as
      // "keep the installed value", which is what an untouched field means.
      if (license.trim()) overrides.license = license.trim();
      if (homepage.trim()) overrides.homepage = homepage.trim();

      await exportTheme(id, overrides, dest);
      onExported();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const loaded = theme !== null;
  const palette = theme ? resolvedPair(id, { [id]: theme }).dark : null;

  return (
    <div
      className="ovl absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,13,0.7)]"
      onMouseDown={closeIfOutside}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Export theme: ${loaded ? theme.name : id}`}
        onKeyDown={trapTab}
        className="flex max-h-[min(620px,calc(100%-40px))] w-[min(460px,calc(100%-40px))] flex-col overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-extrabold tracking-tight text-ink">
              {loaded ? `Export Theme: ${name.trim() || id}` : "Export Theme"}
            </h3>
            <p className="mt-0.5 truncate font-mono-data text-[10px] text-muted">{id}</p>
            {/* Phase 1 packages no images, so the theme's own tokens are the only preview there is. */}
            {palette && (
              <div className="mt-1.5 flex gap-1" aria-hidden="true">
                {SWATCH_TOKENS.map((t) => (
                  <span
                    key={t}
                    className="h-[14px] w-9 rounded-[3px] ring-1 ring-line"
                    style={{ backgroundColor: palette[t] }}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition-colors hover:text-ink"
          >
            <X className="size-[15px]" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
          {!loaded && !error && (
            <div className="flex items-center justify-center gap-1.5 py-8 text-[11px] text-muted">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Reading the theme…</span>
            </div>
          )}

          {loaded && (
            <>
              <Field label="Name">
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>

              <Field label="Author">
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>

              <Field label="Version">
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className={cn(INPUT_CLASS, "font-mono-data text-[11px]")}
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className={cn(INPUT_CLASS, "resize-y")}
                />
              </Field>

              <Field label="Tags">
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-[10px] bg-surface2 px-2 py-[3px] text-[10px] text-ink"
                    >
                      {t}
                      <button
                        onClick={() => setTags((cur) => cur.filter((x) => x !== t))}
                        aria-label={`Remove tag ${t}`}
                        className="text-muted transition-colors hover:text-danger"
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => onTagTyping(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      addTags([tagInput]);
                      setTagInput("");
                    }}
                    placeholder="Add tag…"
                    aria-label="Add tag"
                    className={cn(INPUT_CLASS, "w-auto min-w-[92px] flex-1 py-[3px] text-[10px]")}
                  />
                </div>
              </Field>

              <Field label="License">
                <input
                  type="text"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  placeholder="MIT"
                  className={INPUT_CLASS}
                />
              </Field>

              <Field label="Website">
                <input
                  type="text"
                  value={homepage}
                  onChange={(e) => setHomepage(e.target.value)}
                  placeholder="https://…"
                  className={INPUT_CLASS}
                />
              </Field>

              <div className="rounded-[7px] border border-line bg-bg px-3 py-2.5">
                <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted2">
                  Will include
                </p>
                <p className="mt-1 font-mono-data text-[10px] text-ink">theme.json, tokens.json</p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
                  Will NOT include: settings, favourites, or any personal data.
                </p>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-[7px] bg-danger-soft px-3 py-2 ring-1 ring-danger-line">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-danger">
                {loaded ? "Export failed" : "Could not load theme"}
              </p>
              <p className="mt-1 break-words text-[10px] leading-relaxed text-ink">{error}</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-line px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-[6px] border border-line bg-surface2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={!loaded || busy}
            className="flex items-center justify-center gap-1.5 rounded-[6px] bg-accent px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none disabled:hover:brightness-100"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            <span>Export ZIP…</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-wider text-muted2">
        {label}
      </label>
      {children}
    </div>
  );
}
