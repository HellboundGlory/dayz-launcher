import { create } from "zustand";

export interface ConfirmExtras {
  /** Two-column facts shown under the message. */
  rows?: [string, string][];
  /** Runs when the request is cancelled: Cancel, Escape, the backdrop, or a replacing ask. */
  onCancel?: () => void;
  /** A second action beside the confirm button, for "do the other thing instead". */
  altLabel?: string;
  onAlt?: () => void;
  /** Shows the message in a warning box with a triangle. */
  warning?: boolean;
  /** False draws the confirm button like Cancel instead of in the danger colour. */
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmExtras {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  ask: (
    title: string,
    message: string,
    action: () => void,
    confirmLabel?: string,
    extra?: ConfirmExtras,
  ) => void;
  resolve: (confirmed: boolean) => void;
  resolveAlt: () => void;
}

/** Backs the one launcher-owned confirm dialog: any element can `ask()`. */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (title, message, action, confirmLabel = "Confirm", extra = {}) => {
    // Nothing may wait forever on a request the user will never see.
    get().request?.onCancel?.();
    set({
      request: { title, message, confirmLabel, action, destructive: true, ...extra },
    });
  },
  resolve: (confirmed) => {
    const { request } = get();
    set({ request: null });
    if (confirmed) request?.action();
    else request?.onCancel?.();
  },
  resolveAlt: () => {
    const { request } = get();
    set({ request: null });
    request?.onAlt?.();
  },
}));
