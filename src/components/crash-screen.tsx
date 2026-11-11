import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Bug, Copy, ExternalLink, Folder, RotateCcw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { exit } from "@tauri-apps/plugin-process";
import { logClient, openDataFolder } from "@/lib/tauri";
import { openExternalUrl } from "@/lib/external-link";
import { WindowResizeHandles } from "./window-resize-handles";

/** Enough to identify the failure, short enough to copy in one go. */
const MAX_DETAILS = 8000;

/** How long the copy button says "Copied" before going back. */
const COPIED_MS = 2000;

const BUG_REPORT_BASE = "https://github.com/HellboundGlory/dayz-launcher/issues/new";

export function bugReportUrl(version?: string): string {
  const params = new URLSearchParams({ template: "bug_report.yml" });
  const trimmed = version?.trim();
  if (trimmed) params.set("version", trimmed);
  return `${BUG_REPORT_BASE}?${params}`;
}

export function formatCrashDetails(error: unknown, componentStack?: string): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(`${error.name}: ${error.message}`);
    if (error.stack) parts.push(error.stack);
  } else {
    parts.push(String(error));
  }
  if (componentStack) parts.push(`Component stack:${componentStack}`);
  return parts.join("\n").slice(0, MAX_DETAILS);
}

const logWindow = (action: string, error: unknown) =>
  void logClient("window", `${action} failed: ${String(error)}`);

function CrashTitleBar({ maximized }: { maximized: boolean }) {
  const maximizeLabel = maximized ? "Restore" : "Maximise";
  const minimize = () => {
    getCurrentWindow().minimize().catch((e) => logWindow("minimize", e));
  };
  const toggleMaximize = () => {
    getCurrentWindow().toggleMaximize().catch((e) => logWindow("toggleMaximize", e));
  };
  const close = () => {
    // Quits the process rather than closing the window, which may hide to the tray.
    exit(0).catch((e) => {
      logWindow("exit", e);
      getCurrentWindow().close().catch((err) => logWindow("close", err));
    });
  };

  return (
    <div
      data-part="titlebar"
      data-tauri-drag-region="deep"
      title="Drag to move the window; double-click to maximise"
    >
      <span data-part="name">
        <i aria-hidden />
        Tetra Launcher · crashed
      </span>
      <button type="button" aria-label="Minimise" title="Minimise" onClick={minimize}>
        <svg viewBox="0 0 14 14" aria-hidden>
          <path d="M2 7h10" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        onClick={toggleMaximize}
      >
        <svg viewBox="0 0 14 14" aria-hidden>
          {maximized ? (
            <>
              <rect x="2.5" y="4.5" width="7" height="7" />
              <path d="M4.5 4.5v-2h7v7h-2" />
            </>
          ) : (
            <rect x="2.5" y="2.5" width="9" height="9" />
          )}
        </svg>
      </button>
      <button type="button" data-part="close" aria-label="Close" title="Close" onClick={close}>
        <svg viewBox="0 0 14 14" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export function CrashScreen({ details }: { details: string }) {
  const reloadRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [reportState, setReportState] = useState<"idle" | "failed">("idle");
  const [maximized, setMaximized] = useState(false);
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    reloadRef.current?.focus();
  }, []);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (reportState === "idle") return;
    const timer = setTimeout(() => setReportState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [reportState]);

  useEffect(() => {
    void getVersion()
      .then((value) => setVersion(value || undefined))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    // Nothing above this screen catches a throw, so even a missing window handle is only logged.
    try {
      const win = getCurrentWindow();
      const read = () => {
        win
          .isMaximized()
          .then((value) => {
            if (!cancelled) setMaximized(value);
          })
          .catch((e) => logWindow("isMaximized", e));
      };
      read();
      win
        .onResized(read)
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch((e) => logWindow("onResized", e));
    } catch (e) {
      logWindow("getCurrentWindow", e);
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const report = async () => {
    try {
      await openExternalUrl(bugReportUrl(version));
    } catch (error) {
      void logClient("crash", `openExternalUrl failed: ${String(error)}`);
      setReportState("failed");
    }
  };

  return (
    <div data-crash data-maximized={maximized ? "" : undefined}>
      <CrashTitleBar maximized={maximized} />
      <div data-part="body" role="alert" aria-labelledby="crash-title">
        <div>
          <span data-part="icon">
            <Bug size={30} aria-hidden />
          </span>
          <h2 id="crash-title">Something went wrong</h2>
          <p>
            Tetra hit an error it couldn&apos;t recover from. Your favourites and settings are safe. The
            details below are already in the log.
          </p>
          <pre data-part="details">{details}</pre>
          <div data-part="actions">
            <button
              ref={reloadRef}
              type="button"
              data-part="reload"
              onClick={() => window.location.reload()}
            >
              <RotateCcw size={14} aria-hidden />
              Reload
            </button>
            <button type="button" data-part="copy" onClick={() => void copy()}>
              <Copy size={14} aria-hidden />
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy" : "Copy details"}
            </button>
            <button type="button" data-part="open-log" onClick={() => void openDataFolder()}>
              <Folder size={14} aria-hidden />
              Open log folder
            </button>
            <button
              type="button"
              data-part="report"
              title="Opens the bug report form on GitHub in your browser"
              onClick={() => void report()}
            >
              <ExternalLink size={14} aria-hidden />
              {reportState === "failed" ? "Couldn't open" : "Report on GitHub"}
            </button>
          </div>
          <p data-part="hint">
            To report it, copy the details, then press Report on GitHub and paste them into the form.
          </p>
        </div>
      </div>
      <span data-part="grip" aria-hidden />
      <WindowResizeHandles />
    </div>
  );
}

export class CrashBoundary extends Component<{ children: ReactNode }, { details: string | null }> {
  state: { details: string | null } = { details: null };

  static getDerivedStateFromError(error: unknown) {
    return { details: formatCrashDetails(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    void logClient("crash", formatCrashDetails(error, info.componentStack ?? undefined));
  }

  render() {
    if (this.state.details !== null) return <CrashScreen details={this.state.details} />;
    return this.props.children;
  }
}

/**
 * Writes every render-independent failure to the log: uncaught errors and
 * unhandled promise rejections never reach the boundary, so they are only logged.
 */
const MAX_CRASH_LINES = 20;

export function installCrashLogging(
  target: Pick<Window, "addEventListener">,
  log: (level: string, message: string) => void,
): () => void {
  // An error loop must not fill the log, which is capped in size.
  let logged = 0;
  const logOnce = (message: string) => {
    if (logged > MAX_CRASH_LINES) return;
    logged++;
    log("crash", logged > MAX_CRASH_LINES ? "Further errors are not logged until a reload." : message);
  };
  const onError = (event: Event) => {
    const { message, filename, lineno } = event as ErrorEvent;
    // WebKit reports this harmless notice as an error.
    if (message?.startsWith("ResizeObserver loop")) return;
    const source = filename ? ` (${filename}${lineno ? `:${lineno}` : ""})` : "";
    logOnce(`${message || "Uncaught error"}${source}`);
  };
  const onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    logOnce(`Unhandled promise rejection: ${formatCrashDetails(reason)}`);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  // Anything you can listen on can stop listening.
  const removable = target as unknown as Pick<Window, "removeEventListener">;
  return () => {
    removable.removeEventListener("error", onError);
    removable.removeEventListener("unhandledrejection", onRejection);
  };
}
