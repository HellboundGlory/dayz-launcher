import { useServerDataLoader } from "@/hooks/use-server-data-loader";
import { useAddressLookup } from "@/hooks/use-address-lookup";

/**
 * Runs the two effects that drive the server list. They subscribe to the
 * visible range and the settled search, so keeping them in their own component
 * stops `App` from re-rendering on every scroll and search.
 */
export function ServerDataEffects() {
  useServerDataLoader();
  useAddressLookup();
  return null;
}
