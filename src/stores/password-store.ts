import { create } from "zustand";

export interface PasswordRequest {
  addr: string;
  serverName: string;
  keyring: boolean;
}

export interface PasswordEntry {
  password: string;
  remember: boolean;
}

type Resolver = (entry: PasswordEntry | null) => void;

interface PasswordState {
  request: PasswordRequest | null;
  draft: string;
  remember: boolean;
  reveal: boolean;
  ask: (request: PasswordRequest) => Promise<PasswordEntry | null>;
  setDraft: (draft: string) => void;
  setRemember: (remember: boolean) => void;
  toggleReveal: () => void;
  submit: () => void;
  cancel: () => void;
}

// Outside the state so a re-render never sees the resolver as display data.
let pending: Resolver | null = null;

function settle(entry: PasswordEntry | null) {
  const resolve = pending;
  pending = null;
  usePasswordStore.setState({ request: null, draft: "", reveal: false });
  resolve?.(entry);
}

/** Backs the password dialog: the join gate asks, the dialog answers. */
export const usePasswordStore = create<PasswordState>((set, get) => ({
  request: null,
  draft: "",
  remember: false,
  reveal: false,
  ask: (request) => {
    settle(null);
    return new Promise<PasswordEntry | null>((resolve) => {
      pending = resolve;
      set({ request, draft: "", remember: request.keyring, reveal: false });
    });
  },
  setDraft: (draft) => set({ draft }),
  setRemember: (remember) => set({ remember }),
  toggleReveal: () => set((s) => ({ reveal: !s.reveal })),
  submit: () => {
    const { draft, remember, request } = get();
    if (!draft) return;
    settle({ password: draft, remember: remember && !!request?.keyring });
  },
  cancel: () => settle(null),
}));
