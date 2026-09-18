import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { effective, useThemeStore } from "@/theme/theme-store";
import { parseTokens, resolveTokens } from "@/theme/tokens";
import { useDevStore } from "@/theme/dev/dev-store";
import { useFallbackStore } from "@/theme/fallback/store";
import type { ValidationIssue } from "@/types/theme";
import { DevModeSwitcher } from "./DevModeSwitcher";

type CopyState = { key: string; status: "copied" | "failed" } | null;

function groupByFile(issues: ValidationIssue[]): [string, ValidationIssue[]][] {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    map.set(issue.file, [...(map.get(issue.file) ?? []), issue]);
  }
  return [...map.entries()];
}

function summarize(issues: ValidationIssue[], contrast: ValidationIssue[]): string {
  const all = [...issues, ...contrast];
  const errors = all.filter((i) => i.severity === "error").length;
  const warnings = all.filter((i) => i.severity === "warning").length;
  if (errors === 0 && warnings === 0) return "No issues";
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function IssueRow({
  issue,
  copyState,
  onCopy,
}: {
  issue: ValidationIssue;
  copyState: CopyState;
  onCopy: (file: string, pointer: string) => void;
}) {
  const key = `${issue.file}#${issue.pointer}`;
  const copied = copyState?.key === key;
  return (
    <div className="flex flex-col gap-0.5 [border-radius:var(--t-radius-chip)] border [border-color:rgba(255,79,216,0.25)] px-1.5 py-1">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "[border-radius:var(--t-radius-badge)] px-1 py-px [font-size:var(--t-type-caption-size)] font-bold uppercase tracking-[0.04em]",
            issue.severity === "error"
              ? "bg-[rgba(255,90,90,0.2)] [color:rgb(255,140,140)]"
              : "bg-[rgba(255,196,105,0.2)] [color:rgb(255,196,105)]",
          )}
        >
          {issue.severity}
        </span>
        <span className="font-semibold [color:rgb(255,215,246)]">{issue.ruleId}</span>
        <span className="break-all [color:rgb(156,147,173)]">{issue.pointer || "—"}</span>
        <button
          type="button"
          onClick={() => onCopy(issue.file, issue.pointer)}
          className="ml-auto shrink-0 [border-radius:var(--t-radius-chip)] border [border-color:rgb(255,79,216)] px-1.5 py-px [font-size:var(--t-type-compactCaption-size)] uppercase tracking-[0.04em] [color:rgb(255,154,232)] hover:bg-[rgba(255,79,216,0.2)]"
        >
          {copied ? (copyState?.status === "copied" ? "Copied!" : "Copy failed") : "Copy"}
        </button>
      </div>
      <div>{issue.message}</div>
      {issue.hint && <div className="italic [color:rgb(156,147,173)]">{issue.hint}</div>}
    </div>
  );
}

export interface DevModeValidationPanelViewProps {
  themeId: string;
  issues: ValidationIssue[];
  contrast: ValidationIssue[];
  fallbackReasons: Record<string, string[]>;
  error: string | null;
  refreshing: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRefresh: () => void;
  copyState: CopyState;
  onCopy: (file: string, pointer: string) => void;
  switcher?: ReactNode;
  heldReload: boolean;
}

/** Pure markup for the validation panel — no store reads, no portal, no effects. */
export function DevModeValidationPanelView({
  themeId,
  issues,
  contrast,
  fallbackReasons,
  error,
  refreshing,
  collapsed,
  onToggleCollapse,
  onRefresh,
  copyState,
  onCopy,
  switcher,
  heldReload,
}: DevModeValidationPanelViewProps) {
  const isEmpty = issues.length === 0 && contrast.length === 0 && Object.keys(fallbackReasons).length === 0;

  return (
    <div
      data-dev-panel
      className="pointer-events-auto fixed bottom-2 left-2 z-[390] flex flex-col overflow-hidden [border-radius:var(--t-radius-control)] border [border-color:rgb(255,79,216)] bg-[rgba(12,10,16,0.95)] font-mono-data [font-size:var(--t-type-label-size)] leading-[1.5] [color:rgb(233,230,242)] [box-shadow:var(--t-shadow-inspector)]"
      style={{ maxWidth: "min(420px, calc(100vw - 16px))", maxHeight: "60vh" }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 px-2.5 py-2",
          !collapsed && "border-b [border-color:rgba(255,79,216,0.4)]",
        )}
      >
        <span className="[border-radius:var(--t-radius-badge)] bg-[rgba(255,79,216,0.25)] px-1 py-px [font-size:var(--t-type-caption-size)] font-bold uppercase tracking-[0.04em] [color:rgb(255,154,232)]">
          Validation
        </span>
        <span className="break-all font-semibold [color:rgb(255,215,246)]">{themeId}</span>
        <span className="ml-auto shrink-0 [font-size:var(--t-type-caption-size)] uppercase tracking-[0.04em] [color:rgb(156,147,173)]">
          {refreshing ? "Checking…" : summarize(issues, contrast)}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="shrink-0 [border-radius:var(--t-radius-chip)] border [border-color:rgb(255,79,216)] px-1.5 py-px [font-size:var(--t-type-compactCaption-size)] uppercase tracking-[0.04em] [color:rgb(255,154,232)] hover:bg-[rgba(255,79,216,0.2)]"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className="shrink-0 [border-radius:var(--t-radius-chip)] border [border-color:rgb(255,79,216)] px-1.5 py-px [font-size:var(--t-type-compactCaption-size)] uppercase tracking-[0.04em] [color:rgb(255,154,232)] hover:bg-[rgba(255,79,216,0.2)]"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2.5 py-2">
          {switcher}

          {heldReload && (
            <div className="[color:rgb(255,140,140)]">
              Hot reload held — the saved files have errors; still showing the last valid version.
            </div>
          )}

          {error && (
            <div className="[color:rgb(255,140,140)]">Could not validate: {error}</div>
          )}

          {issues.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="uppercase tracking-[0.04em] [color:rgb(156,147,173)]">Errors and warnings</div>
              {groupByFile(issues).map(([file, group]) => (
                <div key={file} className="flex flex-col gap-1">
                  <div className="break-all font-semibold [color:rgb(255,215,246)]">{file}</div>
                  {group.map((issue, i) => (
                    <IssueRow key={`${file}-${i}`} issue={issue} copyState={copyState} onCopy={onCopy} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {Object.keys(fallbackReasons).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="uppercase tracking-[0.04em] [color:rgb(156,147,173)]">Fell back to Neutral</div>
              {Object.entries(fallbackReasons).map(([file, reasons]) => (
                <div key={file} className="flex flex-col gap-0.5">
                  <div className="break-all font-semibold [color:rgb(255,215,246)]">{file}</div>
                  <ul className="list-disc pl-4">
                    {reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {contrast.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="uppercase tracking-[0.04em] [color:rgb(156,147,173)]">Contrast</div>
              {contrast.map((issue, i) => (
                <IssueRow key={i} issue={issue} copyState={copyState} onCopy={onCopy} />
              ))}
            </div>
          )}

          {isEmpty && <div className="[color:rgb(156,147,173)]">No issues</div>}
        </div>
      )}
    </div>
  );
}

/** Mounted while Dev Mode is on: reads the dev/fallback stores, keeps them
 * refreshed against the active theme, and drops the session state on unmount. */
export function DevModeValidationPanel() {
  const activeId = useThemeStore((s) => s.activeId);
  const scheme = useThemeStore((s) => s.scheme);
  const activeFile = useThemeStore((s) => s.themeFiles[s.activeId]);
  const issues = useDevStore((s) => s.issues);
  const contrast = useDevStore((s) => s.contrast);
  const refreshing = useDevStore((s) => s.refreshing);
  const error = useDevStore((s) => s.error);
  const heldReload = useDevStore((s) => s.heldReload);
  const refresh = useDevStore((s) => s.refresh);
  const clear = useDevStore((s) => s.clear);
  const fallbackReasons = useFallbackStore((s) => s.fallbackReasons);

  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>(null);
  const copyResetTimer = useRef<number | null>(null);

  const doRefresh = useCallback(() => {
    const { activeId: id, scheme: currentScheme, custom, themeFiles } = useThemeStore.getState();
    const palette = effective(currentScheme, id, themeFiles, custom);
    const tokenFile = themeFiles[id]?.tokens as Record<string, unknown> | undefined;
    const resolved = resolveTokens(tokenFile?.schemaVersion === 2 ? parseTokens(tokenFile) : undefined);
    const roleColors = Object.fromEntries(
      Object.entries(resolved.roles.color).map(([k, v]) => [k, String(v)]),
    );
    void refresh(id, palette, roleColors, currentScheme);
  }, [refresh]);

  useEffect(() => {
    doRefresh();
    // Also re-runs when the active theme's own file identity changes, so a
    // hot reload that swaps in new tokens recomputes contrast against them.
  }, [activeId, scheme, activeFile, doRefresh]);

  useEffect(() => {
    return () => clear();
  }, [clear]);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    };
  }, []);

  const handleCopy = useCallback((file: string, pointer: string) => {
    const key = `${file}#${pointer}`;
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    void (async () => {
      try {
        await navigator.clipboard.writeText(key);
        setCopyState({ key, status: "copied" });
      } catch {
        setCopyState({ key, status: "failed" });
      }
      copyResetTimer.current = window.setTimeout(() => setCopyState(null), 1800);
    })();
  }, []);

  return createPortal(
    <DevModeValidationPanelView
      themeId={activeId}
      issues={issues}
      contrast={contrast}
      fallbackReasons={fallbackReasons}
      error={error}
      refreshing={refreshing}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      onRefresh={doRefresh}
      copyState={copyState}
      onCopy={handleCopy}
      switcher={<DevModeSwitcher />}
      heldReload={heldReload}
    />,
    document.body,
  );
}
