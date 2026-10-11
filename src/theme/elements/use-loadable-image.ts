import { useState } from "react";

/** The url while its image loads, `null` once it fails; a different url is tried again. */
export function useLoadableImage(url: string | null | undefined): [string | null, () => void] {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  return [url && url !== brokenUrl ? url : null, () => setBrokenUrl(url ?? null)];
}
