import { create } from "zustand";

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  ask: (title: string, message: string, action: () => void, confirmLabel?: string) => void;
  resolve: (confirmed: boolean) => void;
}

/** Backs the one launcher-owned confirm dialog (ADR-0024): any element can `ask()`. */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (title, message, action, confirmLabel = "Confirm") =>
    set({ request: { title, message, confirmLabel, action } }),
  resolve: (confirmed) => {
    const { request } = get();
    set({ request: null });
    if (confirmed) request?.action();
  },
}));
