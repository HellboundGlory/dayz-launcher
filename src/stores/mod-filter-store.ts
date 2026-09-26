import { create } from "zustand";
import { useServerStore } from "@/stores/server-store";
import { visibleRows } from "@/stores/mods-store";
import {
  getKnownMods,
  getWorkshopPreviews,
  searchWorkshopMods,
  type KnownMod,
  type SubscribedMod,
  type WorkshopSearchResult,
} from "@/lib/tauri";

export type ModFilterTab = "subscribed" | "seen" | "workshop";

/** A mod is required, kept off the list, or neither — never both at once. */
export type ModPick = "include" | "exclude";

/** How long typing pauses before the Workshop search re-queries — same budget as the server search box. */
const SEARCH_DEBOUNCE_MS = 350;

/** One mod, whichever tab it came from, in the shape the list row and preview pane render. */
export interface ModFilterEntry {
  id: string;
  title: string;
  previewUrl: string | null;
  subscribed: boolean;
  serverCount: number | null;
  description: string | null;
  tags: string[];
  numSubscriptions: string | null;
  score: number | null;
  fileSize: number | null;
  timeUpdated: number | null;
  workshopUrl: string | null;
}

/** The minimal shape `cycle`/`setPick` need to remember a mod's display meta. */
export interface ModFilterPickable {
  id: string;
  title: string;
  previewUrl: string | null;
}

interface ModFilterState {
  tab: ModFilterTab;
  query: string;
  selection: Record<string, ModPick>;
  mode: "any" | "all";
  previewId: string | null;
  meta: Record<string, { title: string; previewUrl: string | null }>;

  known: KnownMod[] | null;
  knownLoading: boolean;

  searchResults: WorkshopSearchResult[];
  searchLoading: boolean;
  searchError: string | null;

  usage: Record<string, number>;

  /** Seed the working selection/match mode from the live server filter — call on open. */
  begin: () => void;
  /** Write the working selection/match mode back to the server filter. */
  apply: () => void;

  setTab: (tab: ModFilterTab) => void;
  setQuery: (query: string) => void;
  setMode: (mode: "any" | "all") => void;
  setPreviewId: (id: string | null) => void;
  /** Row checkbox: cycles none → include → exclude → none. */
  cycle: (entry: ModFilterPickable) => void;
  /** Preview pane's Include/Exclude buttons: pick a specific state, or clear it
      if that state is already active — same result as cycling back to none. */
  setPick: (entry: ModFilterPickable, pick: ModPick) => void;
  clearSelection: () => void;

  loadKnownMods: () => Promise<void>;
  mergeUsage: (rows: { workshop_id: string; total_servers: number }[]) => void;
}

function initialModFilterState() {
  return {
    tab: "subscribed" as ModFilterTab,
    query: "",
    selection: {} as Record<string, ModPick>,
    mode: "any" as "any" | "all",
    previewId: null as string | null,
    meta: {} as Record<string, { title: string; previewUrl: string | null }>,
    known: null as KnownMod[] | null,
    knownLoading: false,
    searchResults: [] as WorkshopSearchResult[],
    searchLoading: false,
    searchError: null as string | null,
    usage: {} as Record<string, number>,
  };
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchToken = 0;
let knownToken = 0;

async function fillKnownPreviews(ids: string[], token: number): Promise<void> {
  let previews: Record<string, string>;
  try {
    previews = await getWorkshopPreviews(ids);
  } catch {
    return;
  }
  if (token !== knownToken || Object.keys(previews).length === 0) return;
  useModFilterStore.setState((s) => ({
    known: s.known?.map((m) => (previews[m.workshop_id] ? { ...m, preview_url: previews[m.workshop_id] } : m)) ?? null,
  }));
}

// Debounced Workshop text search — only the "workshop" tab drives it, and
// it stays empty (a prompt, not a list) until the user actually types.
function runWorkshopSearch(
  tab: ModFilterTab,
  query: string,
  set: (partial: Partial<ModFilterState>) => void,
) {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  if (tab !== "workshop") return;
  searchToken++;
  const token = searchToken;
  const q = query.trim();
  if (!q) {
    set({ searchResults: [], searchLoading: false, searchError: null });
    return;
  }
  set({ searchLoading: true });
  searchTimer = setTimeout(() => {
    searchWorkshopMods(q)
      .then((rows) => {
        if (token !== searchToken) return;
        set({ searchResults: rows, searchError: null });
      })
      .catch((e) => {
        if (token !== searchToken) return;
        set({ searchResults: [], searchError: String(e) });
      })
      .finally(() => {
        if (token !== searchToken) return;
        set({ searchLoading: false });
      });
  }, SEARCH_DEBOUNCE_MS);
}

export const useModFilterStore = create<ModFilterState>((set, get) => ({
  ...initialModFilterState(),

  begin: () => {
    const filter = useServerStore.getState().filter;
    const selection: Record<string, ModPick> = {};
    for (const id of filter.mod_ids) selection[id] = "include";
    for (const id of filter.mod_ids_exclude) selection[id] = "exclude";
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    set({ ...initialModFilterState(), selection, mode: filter.mod_match });
  },

  apply: () => {
    const { included, excluded } = pickSummary(get().selection);
    useServerStore.getState().setFilter({
      mod_ids: included,
      mod_match: get().mode,
      mod_ids_exclude: excluded,
    });
  },

  setTab: (tab) => {
    set({ tab, previewId: null, searchError: null });
    runWorkshopSearch(tab, get().query, set);
  },
  setQuery: (query) => {
    set({ query });
    runWorkshopSearch(get().tab, query, set);
  },
  setMode: (mode) => set({ mode }),
  setPreviewId: (id) => set({ previewId: id }),

  cycle: (entry) => {
    set((s) => {
      const next = { ...s.selection };
      if (next[entry.id] === "include") next[entry.id] = "exclude";
      else if (next[entry.id] === "exclude") delete next[entry.id];
      else next[entry.id] = "include";
      return {
        selection: next,
        meta: { ...s.meta, [entry.id]: { title: entry.title, previewUrl: entry.previewUrl } },
      };
    });
  },
  setPick: (entry, pick) => {
    set((s) => {
      const next = { ...s.selection };
      if (next[entry.id] === pick) delete next[entry.id];
      else next[entry.id] = pick;
      return {
        selection: next,
        meta: { ...s.meta, [entry.id]: { title: entry.title, previewUrl: entry.previewUrl } },
      };
    });
  },
  clearSelection: () => set({ selection: {} }),

  loadKnownMods: async () => {
    knownToken++;
    const token = knownToken;
    set({ knownLoading: true });
    try {
      const rows = await getKnownMods();
      if (token !== knownToken) return;
      set({ known: rows });
      const missing = rows.filter((m) => !m.preview_url).map((m) => m.workshop_id);
      if (missing.length > 0) void fillKnownPreviews(missing, token);
    } catch {
      if (token !== knownToken) return;
      set({ known: [] });
    } finally {
      if (token === knownToken) set({ knownLoading: false });
    }
  },

  mergeUsage: (rows) => {
    set((s) => {
      const next = { ...s.usage };
      for (const r of rows) next[r.workshop_id] = r.total_servers;
      return { usage: next };
    });
  },
}));

/** Split a selection map into its included/excluded id lists. */
export function pickSummary(selection: Record<string, ModPick>): {
  included: string[];
  excluded: string[];
} {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const [id, pick] of Object.entries(selection)) {
    if (pick === "include") included.push(id);
    else excluded.push(id);
  }
  return { included, excluded };
}

/** Subscribed rows the "Subscribed" tab shows: DayZ items only, alphabetised. */
export function subscribedForDayz(rows: SubscribedMod[]): SubscribedMod[] {
  return visibleRows(rows)
    .filter((m) => m.for_dayz)
    .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
}

function fromSubscribed(m: SubscribedMod, usage: Record<string, number>): ModFilterEntry {
  return {
    id: m.workshop_id,
    title: m.title || `Workshop item ${m.workshop_id}`,
    previewUrl: m.preview_url,
    subscribed: true,
    serverCount: usage[m.workshop_id] ?? null,
    description: m.description,
    tags: m.tags,
    numSubscriptions: m.num_subscriptions || null,
    score: m.score || null,
    fileSize: m.file_size || null,
    timeUpdated: m.time_updated || null,
    workshopUrl: m.workshop_url,
  };
}

function fromKnown(m: KnownMod, subscribedIds: Set<string>): ModFilterEntry {
  return {
    id: m.workshop_id,
    title: m.name || `Workshop item ${m.workshop_id}`,
    previewUrl: m.preview_url,
    subscribed: subscribedIds.has(m.workshop_id),
    serverCount: m.server_count,
    description: null,
    tags: [],
    numSubscriptions: null,
    score: null,
    fileSize: null,
    timeUpdated: null,
    workshopUrl: null,
  };
}

function fromSearch(
  m: WorkshopSearchResult,
  usage: Record<string, number>,
  subscribedIds: Set<string>,
): ModFilterEntry {
  return {
    id: m.workshop_id,
    title: m.title,
    previewUrl: m.preview_url,
    subscribed: subscribedIds.has(m.workshop_id),
    serverCount: usage[m.workshop_id] ?? null,
    description: m.description || null,
    tags: m.tags,
    numSubscriptions: m.num_subscriptions,
    score: m.score,
    fileSize: m.file_size,
    timeUpdated: m.time_updated,
    workshopUrl: m.workshop_url,
  };
}

/** The rows the active tab shows, filtered by the current search query. */
export function activeEntries(params: {
  tab: ModFilterTab;
  query: string;
  subscribedRows: SubscribedMod[];
  known: KnownMod[] | null;
  searchResults: WorkshopSearchResult[];
  usage: Record<string, number>;
}): ModFilterEntry[] {
  const { tab, query, subscribedRows, known, searchResults, usage } = params;
  const subscribedIds = new Set(subscribedRows.map((m) => m.workshop_id));
  const q = query.trim().toLowerCase();
  if (tab === "subscribed") {
    return subscribedRows
      .filter((m) => !q || (m.title ?? "").toLowerCase().includes(q))
      .map((m) => fromSubscribed(m, usage));
  }
  if (tab === "seen") {
    return (known ?? [])
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .map((m) => fromKnown(m, subscribedIds));
  }
  return searchResults.map((m) => fromSearch(m, usage, subscribedIds));
}
