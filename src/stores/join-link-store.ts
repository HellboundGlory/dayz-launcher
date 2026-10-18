import { create } from "zustand";
import type { Server } from "@/types/server";

/** A `dzsa://connect` link: `port` is the query port the lookup runs against. */
export interface JoinLinkRequest {
  ip: string;
  port: number;
  favourite: boolean;
}

export type JoinLinkPhase = "asking" | "found" | "noanswer";

interface JoinLinkState {
  request: JoinLinkRequest | null;
  server: Server | null;
  phase: JoinLinkPhase;
  open: (request: JoinLinkRequest) => void;
  /** Returns false, and changes nothing, when `request` is no longer the open one. */
  found: (request: JoinLinkRequest, server: Server) => boolean;
  noAnswer: (request: JoinLinkRequest) => void;
  close: () => void;
}

/** The join box's one open link. A lookup answers only the link it was started for. */
export const useJoinLinkStore = create<JoinLinkState>()((set, get) => ({
  request: null,
  server: null,
  phase: "asking",
  open: (request) => set({ request, server: null, phase: "asking" }),
  found: (request, server) => {
    if (get().request !== request) return false;
    set({ server, phase: "found" });
    return true;
  },
  noAnswer: (request) => {
    if (get().request !== request) return;
    set({ phase: "noanswer" });
  },
  close: () => set({ request: null, server: null }),
}));
