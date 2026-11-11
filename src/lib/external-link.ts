import { invoke } from "@tauri-apps/api/core";

/** Open an `https` link to one of the project's own sites in the user's browser. */
export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}
