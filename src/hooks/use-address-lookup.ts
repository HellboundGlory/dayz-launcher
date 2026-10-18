import { useEffect, useRef } from "react";
import { useServerStore } from "@/stores/server-store";
import { lookupServer } from "@/lib/tauri";
import { addressInSearch } from "@/lib/address";

/** Asks the server directly for an address search the registry has no match for. */
export function useAddressLookup() {
  const settled = useServerStore((s) => s.settled);
  // One ask per search text; a new text is a new ask.
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!settled || settled.total !== 0) return;
    const search = settled.search;
    const addr = addressInSearch(search ?? "");
    if (addr === null || search === asked.current) return;
    asked.current = search;

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
