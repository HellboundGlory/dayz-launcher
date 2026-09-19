// The pure functions the theme dialogs and grid derive display text from: the
// capability strings the backend validated -> labels, and the grid's single
// capability label (SPEC §3.3). Kept out of any one dialog since both import/
// export dialogs and the grid need them.

/** The order both dialogs list capabilities in, whatever order a manifest uses. */
const CAPABILITY_ORDER = ["tokens", "layout", "css", "fonts", "assets"] as const;

export type Capability = (typeof CAPABILITY_ORDER)[number];

/** What a raw `capabilities` string reads as. The backend rejects a package whose
 * contents outrun what it declares, so these are a validated fact, read rather
 * than re-derived from the package's files. */
const CAPABILITY_LABELS: Record<Capability, string> = {
  tokens: "Tokens",
  layout: "Layout",
  css: "Custom CSS",
  fonts: "Fonts",
  assets: "Assets",
};

/** Labels for whichever of `capabilities` are present; an unknown string is
 * dropped rather than echoed raw. `only` narrows to a subset for callers that
 * describe some of these as files instead. */
export function capabilityLabels(
  capabilities: readonly string[],
  only: readonly Capability[] = CAPABILITY_ORDER,
): string[] {
  const declared = new Set(capabilities);
  return only.filter((raw) => declared.has(raw)).map((raw) => CAPABILITY_LABELS[raw]);
}

/** The single grid label for a theme, per SPEC §3.3. */
export function capabilityLabel(
  capabilities: readonly string[],
): "Custom layout" | "Styled" | "Colours" {
  const declared = new Set(capabilities);
  if (declared.has("layout")) return "Custom layout";
  if (declared.has("css") || declared.has("fonts")) return "Styled";
  return "Colours";
}
