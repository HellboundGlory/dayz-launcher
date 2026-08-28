import { create } from "zustand";
import {
  getSubscribedMods,
  getCaredServers,
  getUniqueModsFor,
  getServersNeeding,
  steamModStates,
  steamDownloadProgress,
  verifySubscribedMods,
  steamUnsubscribeMods,
  type SubscribedMod,
  type ModState,
  type CaredServer,
  type ServerNeeding,
} from "@/lib/tauri";

/** How the list is ordered. "Subscribed date" falls back to the install stamp. */
export type ModSortKey = "name" | "subscribed" | "updated" | "size";
export type ModSortDir = "asc" | "desc";

// Trimmed to the three states that appear in the final mockup (handoff §3.1.3).
// The per-row `ModState` union still covers not_installed/not_subscribed/
// not_on_workshop for status labels — only the *filter* narrows.
export type ModStatusFilter = "all" | "outdated" | "downloading";

/** A batch operation the action bar is running (one at a time). */
export interface ModOp {
  kind: "verify" | "unsubscribe" | "cleanup";
  /** Live detail under the action, e.g. `VERIFYING 13…`. */
  note: string | null;
}

interface ModsState {
  /** All rows the backend returned — DayZ items plus removed clean-up ones.
      The component hides `removed` from the list itself. */
  rows: SubscribedMod[];
  /** True when nothing live was asked (Steam offline) and last snapshot shown. */
  fromCache: boolean;
  loading: boolean;
  error: string | null;

  /** Checkbox selection. */
  selectedIds: Set<string>;
  /** The mod showing in the right-hand inspector. */
  selectedModId: string | null;
  /** Set while a "select unique to <server>" selection is active, for the UI to caption. */
  uniqueSource: string | null;
  /** Outcome of the last "select unique" so the user isn't left guessing when
      nothing ends up selected (e.g. a server whose mods are all shared). */
  uniqueResult: { server: string; totalUnique: number; selected: number } | null;

  sortKey: ModSortKey;
  sortDir: ModSortDir;
  search: string;
  statusFilter: ModStatusFilter;

  /** Servers the user cares about, for the unique-per-server dropdown. */
  caredServers: CaredServer[];
  /** Servers needing the currently-inspected mod. */
  needing: ServerNeeding[];

  /** Live state/progress merged from the Steam polls, keyed by workshop id. */
  states: Record<string, ModState>;
  progress: Record<string, { downloaded: string; total: string }>;

  /** The one batch operation in flight, if any. */
  op: ModOp | null;
  /** The last VERIFY result to report, if any. */
  verifyResult: { checked: number; outdated: number; queued: number } | null;
  /** The last unsubscribe outcome, as failures to report. */
  mutationFailures: [string, string][] | null;

  load: (force?: boolean) => Promise<void>;
  setLive: (states: Record<string, ModState>) => void;
  setProgress: (progress: Record<string, { downloaded: string; total: string }>) => void;
  /** Merge fresh details into existing rows (used after a refresh). */
  replaceRows: (rows: SubscribedMod[]) => void;

  toggleSelected: (id: string) => void;
  setAllSelected: (selected: boolean) => void;
  clearSelection: () => void;
  selectIds: (ids: string[]) => void;
  openMod: (id: string | null) => void;

  setSort: (key: ModSortKey) => void;
  setSearch: (search: string) => void;
  setStatusFilter: (filter: ModStatusFilter) => void;

  loadCaredServers: () => Promise<void>;
  selectUniqueTo: (addr: string, queryPort: number, name: string) => Promise<void>;
  loadNeeding: (id: string) => Promise<void>;

  verifySelected: () => Promise<void>;
  verifyAll: () => Promise<void>;
  unsubscribeSelected: () => Promise<void>;
  unsubscribeAll: () => Promise<void>;
  cleanupRemoved: () => Promise<void>;
  clearOp: () => void;
  clearVerifyResult: () => void;
  clearMutationFailures: () => void;
  clearUniqueResult: () => void;
}

/** Rows the user actually sees: everything except removed-for-clean-up items. */
export function visibleRows(rows: SubscribedMod[]): SubscribedMod[] {
  return rows.filter((r) => !r.removed);
}

export const useModsStore = create<ModsState>((set, get) => ({
  rows: [],
  fromCache: false,
  loading: false,
  error: null,
  selectedIds: new Set(),
  selectedModId: null,
  uniqueSource: null,
  uniqueResult: null,
  sortKey: "name",
  sortDir: "asc",
  search: "",
  statusFilter: "all",
  caredServers: [],
  needing: [],
  states: {},
  progress: {},
  op: null,
  verifyResult: null,
  mutationFailures: null,

  load: async (force = false) => {
    if (get().op) return;
    set({ loading: true, error: null });
    try {
      const outcome = await getSubscribedMods(force);
      const rows = outcome.rows;
      const selected = new Set(
        [...get().selectedIds].filter((id) => rows.some((r) => r.workshop_id === id)),
      );
      set({
        rows,
        fromCache: outcome.from_cache,
        loading: false,
        selectedIds: selected,
        selectedModId:
          get().selectedModId && rows.some((r) => r.workshop_id === get().selectedModId)
            ? get().selectedModId
            : null,
      });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  replaceRows: (rows) => {
    set({
      rows,
      selectedIds: new Set(
        [...get().selectedIds].filter((id) => rows.some((r) => r.workshop_id === id)),
      ),
    });
  },

  setLive: (states) => set({ states }),
  setProgress: (progress) => set({ progress }),

  toggleSelected: (id) => {
    const selected = new Set(get().selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    set({ selectedIds: selected });
  },
  setAllSelected: (selected) => {
    const rows = visibleRows(get().rows);
    set({ selectedIds: selected ? new Set(rows.map((r) => r.workshop_id)) : new Set() });
  },
  clearSelection: () => set({ selectedIds: new Set(), uniqueSource: null }),
  selectIds: (ids) => {
    const present = new Set(ids.filter((id) => get().rows.some((r) => r.workshop_id === id)));
    set({ selectedIds: present, uniqueSource: null });
  },
  openMod: (id) => {
    set({ selectedModId: id, needing: [] });
    if (id) void get().loadNeeding(id);
  },

  setSort: (key) => {
    const { sortKey, sortDir } = get();
    set({
      sortKey: key,
      sortDir: sortKey === key && sortDir === "asc" ? "desc" : "asc",
    });
  },
  setSearch: (search) => set({ search }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),

  loadCaredServers: async () => {
    try {
      set({ caredServers: await getCaredServers() });
    } catch {
      set({ caredServers: [] });
    }
  },

  selectUniqueTo: async (addr, queryPort, name) => {
    try {
      const refs = await getUniqueModsFor(addr, queryPort);
      const rowIds = new Set(get().rows.map((r) => r.workshop_id));
      // A unique mod is only selectable if it's actually in the user's library
      // (only subscribed mods render). Unsubscribed-but-unique mods are counted
      // so the outcome line can say what was excluded and why.
      const present = refs.filter((r) => rowIds.has(r.workshop_id)).map((r) => r.workshop_id);
      get().selectIds(present);
      set({
        uniqueSource: name || `${addr}:${queryPort}`,
        uniqueResult: {
          server: name || `${addr}:${queryPort}`,
          totalUnique: refs.length,
          selected: present.length,
        },
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadNeeding: async (id) => {
    try {
      set({ needing: await getServersNeeding(id) });
    } catch {
      set({ needing: [] });
    }
  },

  verifySelected: async () => {
    await runVerify([...get().selectedIds]);
  },
  verifyAll: async () => {
    await runVerify(visibleRows(get().rows).map((r) => r.workshop_id));
  },

  unsubscribeSelected: async () => {
    await runUnsubscribe([...get().selectedIds]);
  },
  unsubscribeAll: async () => {
    await runUnsubscribe(visibleRows(get().rows).map((r) => r.workshop_id));
  },

  cleanupRemoved: async () => {
    const ids = get().rows.filter((r) => r.removed).map((r) => r.workshop_id);
    if (ids.length === 0) return;
    set({ op: { kind: "cleanup", note: `REMOVING ${ids.length}…` } });
    try {
      const outcome = await steamUnsubscribeMods(ids);
      set({
        mutationFailures: outcome.failures.length ? outcome.failures : null,
        op: null,
      });
      void get().load(true);
    } catch (e) {
      set({ op: null, error: String(e) });
    }
  },

  clearOp: () => set({ op: null }),
  clearVerifyResult: () => set({ verifyResult: null }),
  clearMutationFailures: () => set({ mutationFailures: null }),
  clearUniqueResult: () => set({ uniqueResult: null }),
}));

async function runVerify(ids: string[]) {
  const s = useModsStore.getState();
  if (ids.length === 0 || s.op) return;
  set({
    op: { kind: "verify", note: `CHECKING ${ids.length}…` },
    verifyResult: null,
  });
  try {
    const outcomes = await verifySubscribedMods(ids);
    const checked = outcomes.filter((o) => o.known).length;
    const outdated = outcomes.filter((o) => o.outdated).length;
    const queued = outcomes.filter((o) => o.queued).length;
    set({
      op: null,
      verifyResult: { checked, outdated, queued },
    });
    // Re-poll now so the "downloading" dots appear without waiting for the
    // 1.5s poll interval.
    void refreshLiveState();
  } catch (e) {
    set({ op: null, error: String(e) });
  }
}

async function runUnsubscribe(ids: string[]) {
  const s = useModsStore.getState();
  if (ids.length === 0 || s.op) return;
  set({ op: { kind: "unsubscribe", note: `REMOVING ${ids.length}…` } });
  try {
    const outcome = await steamUnsubscribeMods(ids);
    set({
      mutationFailures: outcome.failures.length ? outcome.failures : null,
      op: null,
    });
    // Steam lags its own unsubscribe callback, so re-enumerate to get an
    // authoritative list rather than trusting our stale rows.
    void useModsStore.getState().load(true);
  } catch (e) {
    set({ op: null, error: String(e) });
  }
}

/** One immediate refresh of the live state/progress maps (used after verify). */
async function refreshLiveState() {
  const { rows, setLive, setProgress } = useModsStore.getState();
  const ids = visibleRows(rows).map((r) => r.workshop_id);
  if (ids.length === 0) return;
  try {
    const [entries, progress] = await Promise.all([
      steamModStates(ids),
      steamDownloadProgress(ids),
    ]);
    setLive(Object.fromEntries(entries.map((e) => [e.workshop_id, e.state])));
    setProgress(
      Object.fromEntries(
        progress.map((p) => [p.workshop_id, { downloaded: p.downloaded, total: p.total }]),
      ),
    );
  } catch {
    // Live state is best-effort; the next poll interval retries.
  }
}

/** A tiny `set` bound to the store, so the helpers above stay terse. */
const set = (partial: Partial<ModsState>) => useModsStore.setState(partial);
