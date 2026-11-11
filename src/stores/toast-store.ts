import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface Toast {
  /** The same key is the same toast. */
  key: string;
  tone: ToastTone;
  /** Short label, uppercased by the style: "Update", "Storage", "W02", "Done". */
  tag: string;
  /** Bold lead, usually the server a message is about. */
  title?: string;
  message: string;
  /** Tooltip on the tag, for the coded notices. */
  detail?: string;
  actions?: ToastAction[];
  /** Fades out five seconds after it appears. */
  quick?: boolean;
  /** Default true; false leaves no way to dismiss it. */
  closable?: boolean;
  /** Runs on close, on the five-second timeout and when pushed out. */
  onClose?: () => void;
}

/** A quick toast's whole life. */
const QUICK_TOAST_MS = 5000;
/** How many fit at once before the oldest make way. */
const MAX_TOASTS = 4;

interface Entry {
  toast: Toast;
  /** Fades on its own rather than living while its source produces it. */
  quick: boolean;
  /** A notice produced it, so it goes when the notice does. */
  fromSource: boolean;
  /** What is left of a quick toast's life. */
  remaining: number;
  /** When its clock last started; null while paused. */
  startedAt: number | null;
}

function sameToast(a: Toast, b: Toast): boolean {
  if (
    a.key !== b.key ||
    a.tone !== b.tone ||
    a.tag !== b.tag ||
    a.title !== b.title ||
    a.message !== b.message ||
    a.detail !== b.detail ||
    !!a.quick !== !!b.quick ||
    (a.closable !== false) !== (b.closable !== false) ||
    (a.actions?.length ?? 0) !== (b.actions?.length ?? 0)
  ) {
    return false;
  }
  return (a.actions ?? []).every((action, index) => {
    const other = b.actions![index];
    return (
      action.label === other.label &&
      !!action.disabled === !!other.disabled &&
      !!action.primary === !!other.primary
    );
  });
}

interface ToastState {
  /** In the order they appeared, newest last. */
  entries: Entry[];
  /** Done with until their notice goes away, so a returning notice shows again. */
  closed: string[];
  /** Held back for want of room; not closed. */
  hidden: string[];
  /** The pointer or focus is on the stack, so the clocks wait. */
  paused: boolean;
  /** The last list the sources produced, to ignore a re-render that changed nothing. */
  produced: Toast[];
  showToast: (toast: Toast) => void;
  closeToast: (key: string) => void;
  /** What the notice sources produce right now; they own everything not quick. */
  setNoticeToasts: (toasts: Toast[]) => void;
  setPaused: (paused: boolean) => void;
}

// One timer per quick toast, outside the state: a handle is not something to render.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(key: string) {
  const timer = timers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(key);
}

function armTimer(key: string, ms: number) {
  clearTimer(key);
  timers.set(key, setTimeout(() => expire(key), Math.max(0, ms)));
}

/** Drops the oldest quick toasts, then hides the oldest closeable ones, until four show. */
function fit(entries: Entry[]): void {
  let shown = [...entries];
  const pushedOut: Toast[] = [];
  while (shown.length > MAX_TOASTS) {
    // The newest never makes way: it is the message just asked for.
    const oldest = shown.slice(0, -1).find((entry) => entry.quick);
    if (!oldest) break;
    shown = shown.filter((entry) => entry !== oldest);
    clearTimer(oldest.toast.key);
    pushedOut.push(oldest.toast);
  }

  const hidden: string[] = [];
  const excess = shown.length - MAX_TOASTS;
  if (excess > 0) {
    for (const entry of shown) {
      if (hidden.length === excess) break;
      if (entry.toast.closable !== false) hidden.push(entry.toast.key);
    }
  }

  useToastStore.setState((state) => ({
    entries: shown,
    hidden,
    // Remembered only while their source still produces them, so a message that
    // comes back later shows again.
    closed: [
      ...state.closed,
      ...pushedOut
        .map((toast) => toast.key)
        .filter((key) => state.produced.some((toast) => toast.key === key)),
    ],
  }));
  for (const toast of pushedOut) toast.onClose?.();
}

function expire(key: string) {
  const state = useToastStore.getState();
  const entry = state.entries.find((candidate) => candidate.toast.key === key);
  if (!entry) return;
  clearTimer(key);
  if (state.produced.some((toast) => toast.key === key)) {
    useToastStore.setState({ closed: [...state.closed, key] });
  }
  fit(state.entries.filter((candidate) => candidate !== entry));
  entry.toast.onClose?.();
}

function startEntry(toast: Toast, now: number, paused: boolean, fromNotice: boolean): Entry {
  const quick = toast.quick === true;
  const entry: Entry = {
    toast,
    quick,
    // A quick toast's copy is its own: the source may clear long before it goes.
    fromSource: fromNotice && !quick,
    remaining: QUICK_TOAST_MS,
    startedAt: quick && !paused ? now : null,
  };
  if (entry.startedAt !== null) armTimer(toast.key, QUICK_TOAST_MS);
  return entry;
}

export const useToastStore = create<ToastState>((set, get) => ({
  entries: [],
  closed: [],
  hidden: [],
  paused: false,
  produced: [],

  showToast: (toast) => {
    const state = get();
    const existing = state.entries.find((entry) => entry.toast.key === toast.key);
    if (existing && !existing.quick && !toast.quick) {
      fit(state.entries.map((entry) => (entry === existing ? { ...entry, toast } : entry)));
      return;
    }
    if (state.closed.includes(toast.key)) set({ closed: state.closed.filter((key) => key !== toast.key) });
    // A quick one shown again starts a fresh five seconds.
    const rest = get().entries.filter((entry) => entry !== existing);
    fit([...rest, startEntry(toast, Date.now(), state.paused, false)]);
  },

  closeToast: (key) => {
    const state = get();
    const entry = state.entries.find((candidate) => candidate.toast.key === key);
    if (!entry) return;
    clearTimer(key);
    set({ closed: [...state.closed, key] });
    fit(state.entries.filter((candidate) => candidate !== entry));
    entry.toast.onClose?.();
  },

  setNoticeToasts: (toasts) => {
    const state = get();
    const unchanged =
      toasts.length === state.produced.length &&
      toasts.every((toast, index) => sameToast(toast, state.produced[index]));
    if (unchanged) {
      // Same content, but keep the callbacks current: they may close over newer state.
      for (const toast of toasts) {
        const entry = state.entries.find((candidate) => candidate.toast.key === toast.key);
        if (entry?.fromSource) entry.toast = toast;
      }
      set({ produced: toasts });
      return;
    }
    const produced = new Map(toasts.map((toast) => [toast.key, toast]));
    const now = Date.now();
    const entries = state.entries.filter(
      (entry) => !entry.fromSource || produced.has(entry.toast.key),
    );
    // A key is forgotten once nothing produces it, so a state that comes back shows again.
    const closed = state.closed.filter((key) => produced.has(key));

    for (const toast of toasts) {
      if (closed.includes(toast.key)) continue;
      const index = entries.findIndex((entry) => entry.toast.key === toast.key);
      const existing = entries[index];
      if (existing?.fromSource) {
        existing.toast = toast;
        continue;
      }
      // A quick message produced again starts a fresh five seconds.
      if (existing && state.produced.some((prev) => prev.key === toast.key)) continue;
      if (existing) entries.splice(index, 1);
      entries.push(startEntry(toast, now, state.paused, true));
    }

    set({ closed, produced: toasts });
    fit(entries);
  },

  setPaused: (paused) => {
    const state = get();
    if (state.paused === paused) return;
    const now = Date.now();
    set({
      paused,
      entries: state.entries.map((entry) => {
        if (!entry.quick) return entry;
        const key = entry.toast.key;
        if (paused) {
          const remaining =
            entry.startedAt === null ? entry.remaining : entry.remaining - (now - entry.startedAt);
          clearTimer(key);
          return { ...entry, remaining, startedAt: null };
        }
        armTimer(key, entry.remaining);
        return { ...entry, startedAt: now };
      }),
    });
  },
}));

export function showToast(toast: Toast): void {
  useToastStore.getState().showToast(toast);
}

export function closeToast(key: string): void {
  useToastStore.getState().closeToast(key);
}
