import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Bug, Copy, Folder, RotateCcw } from "lucide-react";
import { logClient, openDataFolder } from "@/lib/tauri";

/** Enough to identify the failure, short enough to copy in one go. */
const MAX_DETAILS = 8000;

/** How long the copy button says "Copied" before going back. */
const COPIED_MS = 2000;

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

export function CrashScreen({ details }: { details: string }) {
  const reloadRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    reloadRef.current?.focus();
  }, []);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div data-crash role="alert" aria-labelledby="crash-title">
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
        </div>
      </div>
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
