import { useEffect, useRef } from "react";
import { useServerStore } from "@/stores/server-store";
import { lookupServer } from "@/lib/tauri";
import { addressInSearch } from "@/lib/address";

/** The address to ask for, if any, and the search text now asked about. One ask per text until it changes. */
export function addressToAsk(
  settled: { search?: string | null; total: number },
  asked: string | null,
): { addr: string | null; asked: string | null } {
  const search = settled.search ?? "";
  const alreadyAsked = search === asked;
  const addr = settled.total === 0 && !alreadyAsked ? addressInSearch(search) : null;
  return { addr, asked: addr !== null || alreadyAsked ? search : null };
}

/** Asks the server directly for an address search the registry has no match for. */
export function useAddressLookup() {
  const settled = useServerStore((s) => s.settled);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    const next = addressToAsk(settled, asked.current);
    asked.current = next.asked;
    const { addr } = next;
    if (addr === null) return;
    const search = settled.search;

    const { setLookup, triggerReload } = useServerStore.getState();
    const stillSearched = () => useServerStore.getState().filter.search === search;
    setLookup({ addr, state: "asking" });
    lookupServer(addr)
      .then((server) => {
        if (!stillSearched()) return;
        if (server) {
          setLookup(null);
          triggerReload();
        } else {
          setLookup({ addr, state: "noanswer" });
        }
      })
      .catch(() => {
        if (stillSearched()) setLookup({ addr, state: "noanswer" });
      });
  }, [settled]);
}
