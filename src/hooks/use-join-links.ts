import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { lookupServer, takePendingConnect, toggleFavourite, type DzsaConnect } from "@/lib/tauri";
import { whenRegistryReady } from "@/lib/registry-ready";
import { useJoinLinkStore, type JoinLinkRequest } from "@/stores/join-link-store";
import { useServerStore } from "@/stores/server-store";
import type { ViewId } from "@/theme/elements/context";

/** Opens the join box for a `dzsa://connect` link and looks its server up. "Try again" re-runs it. */
export function lookUpJoinLink(request: JoinLinkRequest) {
  const { open, found, noAnswer } = useJoinLinkStore.getState();
  open(request);
  void lookupServer(`${request.ip}:${request.port}`)
    .then((server) => {
      if (!server) {
        noAnswer(request);
        return;
      }
      if (!found(request, server)) return;
      useServerStore.getState().setSelectedServer(server);
      if (request.favourite && !server.favourite) {
        useServerStore.getState().toggleFavourite(server.addr);
        void toggleFavourite(server.addr, server.query_port, true).catch((e) => {
          console.error("Failed to persist favourite from dzsa:// link:", e);
          useServerStore.getState().toggleFavourite(server.addr);
        });
      }
    })
    .catch((e) => {
      console.error("Failed to look up dzsa:// link target:", e);
      noAnswer(request);
    });
}

export function useJoinLinks({ handleViewChange }: { handleViewChange: (view: ViewId) => void }) {
  useEffect(() => {
    const handleConnect = ({ ip, queryPort, favourite }: DzsaConnect) => {
      handleViewChange("servers");
      lookUpJoinLink({ ip, port: queryPort, favourite });
    };
    // The link itself lives in the backend; the event only says one arrived.
    const pullPending = () => {
      // A link taken before the registry is open would fail its lookup.
      void whenRegistryReady()
        .then(() => takePendingConnect())
        .then((request) => {
          if (request) handleConnect(request);
        })
        .catch((e) => console.error("Could not read a pending dzsa:// link:", e));
    };
    const unlistenConnect = listen("dzsa-connect", pullPending);
    pullPending();
    return () => {
      unlistenConnect.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
