import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { registryStatus, type RegistryStatus } from "@/lib/tauri";

/** Resolves with the registry's state once the backend has opened it. */
export function whenRegistryReady(): Promise<RegistryStatus> {
  return new Promise((resolve) => {
    let settled = false;
    let stopListening: UnlistenFn | undefined;
    const settle = (status: RegistryStatus) => {
      if (settled) return;
      settled = true;
      resolve(status);
      stopListening?.();
    };
    // Listen before asking, so an open that lands between the two is not missed.
    void listen<RegistryStatus>("registry-ready", (event) => settle(event.payload)).then(
      (unlisten) => {
        if (settled) unlisten();
        else stopListening = unlisten;
      },
    );
    void registryStatus()
      .then((status) => {
        if (status) settle(status);
      })
      // A failed query leaves the event to settle it.
      .catch(() => {});
  });
}
