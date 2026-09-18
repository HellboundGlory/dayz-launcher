import type { LayoutFile, LayoutNode } from "./types";

/** Picks the responsive root for a width: the variant with the highest
 * `minWidth <= width` from the ascending list, or `file.root` when the file
 * declares no variants (§5.2). */
export function resolveVariant(file: LayoutFile, width: number): LayoutNode {
  if (file.variants !== undefined && file.variants.length > 0) {
    let chosen = file.variants[0];
    for (const variant of file.variants) {
      if (variant.minWidth <= width) chosen = variant;
    }
    return chosen.root;
  }
  if (file.root !== undefined) return file.root;
  throw new Error("layout file has neither a root nor any variants");
}
