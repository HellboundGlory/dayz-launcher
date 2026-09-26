import { create } from "zustand";

interface ConfirmRequest {
  title: string;
  message: string;
  action: () => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  ask: (title: string, message: string, action: () => void) => void;
  resolve: (confirmed: boolean) => void;
}

/** Backs the one launcher-owned confirm dialog (ADR-0024): any element can `ask()`. */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (title, message, action) => set({ request: { title, message, action } }),
  resolve: (confirmed) => {
    const { request } = get();
    set({ request: null });
    if (confirmed) request?.action();
  },
}));
