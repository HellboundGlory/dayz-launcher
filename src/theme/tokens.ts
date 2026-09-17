import { NEUTRAL_DARK, NEUTRAL_LIGHT, type Palette } from "./palette";

export type TokenValue = string | number;
type Steps<K extends string> = Partial<Record<K, TokenValue>>;
export interface ColorsV2 {
  dark: Partial<Palette>;
  light: Partial<Palette>;
}
export interface TypeScalesV2 {
  size?: Steps<"3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl">;
  weight?: Steps<"normal" | "medium" | "semibold" | "bold" | "extrabold">;
  tracking?: Steps<"none" | "tight" | "wide" | "wider" | "widest">;
  leading?: Steps<"none" | "tight" | "snug" | "normal" | "relaxed">;
  family?: Steps<"ui" | "data">;
}
export interface MotionScalesV2 {
  duration?: Steps<"fast" | "normal" | "slow">;
  easing?: Steps<"standard" | "linear">;
}
export interface ScalesV2 {
  radius: Steps<"none" | "xs" | "sm" | "md" | "lg" | "full">;
  space: Steps<"0" | "2" | "4" | "6" | "8" | "10" | "12" | "14" | "16" | "18" | "20" | "22" | "24" | "26" | "28" | "30" | "32" | "34" | "36" | "38" | "40" | "42" | "44" | "46" | "48">;
  type: TypeScalesV2;
  border: Steps<"none" | "hairline" | "thick">;
  shadow: Steps<"none" | "sm" | "md" | "lg" | "xl" | "glow">;
  motion: MotionScalesV2;
}
export interface TypeRoleV2 {
  family?: TokenValue;
  size?: TokenValue;
  weight?: TokenValue;
  tracking?: TokenValue;
  leading?: TokenValue;
}
export interface MotionRoleV2 {
  duration?: TokenValue;
  easing?: TokenValue;
}
export interface RolesV2 {
  radius: Steps<"window" | "panel" | "card" | "modal" | "popup" | "row" | "control" | "input" | "chip" | "badge" | "thumb" | "track" | "pill" | "sidebarItem" | "controlSmall" | "popupItem" | "confirm" | "controlCompact" | "readinessRow" | "modalLarge">;
  space: Steps<"windowPad" | "panelPad" | "modalPad" | "popupPad" | "rowX" | "rowY" | "controlX" | "controlY" | "chipX" | "chipY" | "stackGap" | "inlineGap" | "sectionGap" | "listGap" | "controlCompactX" | "controlCompactY" | "controlSmallX" | "controlSmallY" | "sidebarPad" | "sidebarSettingsPad" | "sidebarLogoY" | "sidebarListGap" | "sidebarItemGap" | "inlineGapWide" | "inlineGapSmall" | "popupFilterPad" | "popupOffset" | "popupClearGap" | "separatorX" | "separatorY" | "footerX" | "footerY" | "footerGap" | "stateChipY" | "windowControlWidth" | "windowControlHeight" | "sidebarWidth" | "sidebarToggleOffset" | "sidebarToggleHeight" | "searchMinWidth" | "popupMinWidth" | "popupMaxHeight" | "scaleTrackWidth" | "scaleKnobSize" | "sliderHeight" | "stateDotSize" | "pingTrackWidth" | "dataWidth" | "iconTiny" | "iconSmall" | "iconChevron" | "iconMedium" | "iconLarge" | "iconBox" | "sidebarCollapsedWidth">;
  type: Partial<Record<"display" | "heading" | "subheading" | "body" | "label" | "caption" | "micro" | "button" | "chip" | "data" | "rowName" | "rowMeta" | "statValue" | "statCaption" | "brand" | "compactMicro" | "compactCaption" | "compactBody" | "compactHeading" | "compactSubheading" | "compactTitle", TypeRoleV2>>;
  color: Steps<"onAccent" | "onAccent2" | "onDanger" | "onSuccess" | "focusRing" | "scrim" | "rowHover" | "rowSelected">;
  border: Steps<"hairline" | "control" | "focus">;
  shadow: Steps<"panel" | "modal" | "popup" | "drawer" | "glow" | "popupFilter" | "stateWarning" | "confirm" | "readinessWarning" | "readinessSuccess" | "statusDot" | "update" | "inspector">;
  motion: Partial<Record<"hover" | "expand" | "overlay", MotionRoleV2>>;
}
export interface TokensV2 {
  schemaVersion: 2;
  colors?: Partial<ColorsV2>;
  bloom?: number;
  scales?: Partial<ScalesV2>;
  roles?: Partial<RolesV2>;
}

type Complete<T> = { [K in keyof T]-?: T[K] extends object | undefined ? Complete<NonNullable<T[K]>> : T[K] };
export type ResolvedTokensV2 = Complete<TokensV2>;

const typeRole = (size: string, weight = "normal", family = "ui", tracking = "none", leading = "normal") =>
  ({ family, size, weight, tracking, leading });

export const NEUTRAL_TOKENS: TokensV2 & ResolvedTokensV2 = {
  schemaVersion: 2,
  colors: { dark: { ...NEUTRAL_DARK }, light: { ...NEUTRAL_LIGHT } },
  bloom: 0.9,
  scales: {
    radius: { none: 0, xs: "2px", sm: "4px", md: "6px", lg: "8px", full: "9999px" },
    space: { "0": "0px", "2": "2px", "4": "4px", "6": "6px", "8": "8px", "10": "10px", "12": "12px", "14": "14px", "16": "16px", "18": "18px", "20": "20px", "22": "22px", "24": "24px", "26": "26px", "28": "28px", "30": "30px", "32": "32px", "34": "34px", "36": "36px", "38": "38px", "40": "40px", "42": "42px", "44": "44px", "46": "46px", "48": "48px" },
    type: {
      size: { "3xs": "7px", "2xs": "8px", xs: "9px", sm: "10px", md: "11px", lg: "12px", xl: "13px", "2xl": "14px", "3xl": "22px" },
      weight: { normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },
      tracking: { none: 0, tight: "-0.025em", wide: "0.025em", wider: "0.05em", widest: "0.1em" },
      leading: { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625 },
      family: { ui: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", data: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
    },
    border: { none: 0, hairline: "1px", thick: "2px" },
    shadow: { none: "none", sm: "0 8px 24px rgba(0,0,0,0.4)", md: "0 10px 28px rgba(0,0,0,0.5)", lg: "0 12px 40px rgba(0,0,0,0.5)", xl: "0 24px 60px rgba(0,0,0,0.6)", glow: "var(--glow)" },
    motion: { duration: { fast: "150ms", normal: "200ms", slow: "300ms" }, easing: { standard: "cubic-bezier(0.4, 0, 0.2, 1)", linear: "linear" } },
  },
  roles: {
    radius: { window: "lg", panel: "9px", card: "lg", modal: "10px", popup: "7px", row: "lg", control: "md", input: "md", chip: "sm", badge: "3px", thumb: "7px", track: "xs", pill: "full", sidebarItem: "7px", controlSmall: "sm", popupItem: "5px", confirm: "lg", controlCompact: "5px", readinessRow: "5px", modalLarge: "12px" },
    space: { windowPad: "0", panelPad: "16", modalPad: "14", popupPad: "4", rowX: "12", rowY: "8", controlX: "12", controlY: "6", chipX: "4", chipY: "1px", stackGap: "12", inlineGap: "6", sectionGap: "14", listGap: "6", controlCompactX: "8", controlCompactY: "5px", controlSmallX: "10", controlSmallY: "2", sidebarPad: "8", sidebarSettingsPad: "10", sidebarLogoY: "14", sidebarListGap: "3px", sidebarItemGap: "10", inlineGapWide: "8", inlineGapSmall: "4", popupFilterPad: "5px", popupOffset: "5px", popupClearGap: "7px", separatorX: "2", separatorY: "4", footerX: "14", footerY: "7px", footerGap: "14", stateChipY: "3px", windowControlWidth: "40", windowControlHeight: "28", sidebarWidth: "176px", sidebarToggleOffset: "96px", sidebarToggleHeight: "46", searchMinWidth: "140px", popupMinWidth: "190px", popupMaxHeight: "320px", scaleTrackWidth: "120px", scaleKnobSize: "7px", sliderHeight: "3px", stateDotSize: "5px", pingTrackWidth: "56px", dataWidth: "36", iconTiny: "11px", iconSmall: "12", iconChevron: "13px", iconMedium: "14", iconLarge: "18", iconBox: "22", sidebarCollapsedWidth: "52px" },
    type: {
      display: typeRole("3xl", "extrabold", "data", "none", "none"), heading: typeRole("2xl", "bold", "ui", "none", "snug"), subheading: typeRole("lg", "semibold"), body: typeRole("md"), label: typeRole("sm", "semibold"), caption: typeRole("xs", "normal", "ui", "none", "1.4"), micro: typeRole("2xs"), button: typeRole("sm", "bold", "ui", "wider"), chip: typeRole("2xs", "bold", "ui", "0.04em", "1.3"), data: typeRole("sm", "normal", "data"), rowName: typeRole("lg", "semibold"), rowMeta: typeRole("xs"), statValue: typeRole("xl", "bold", "data", "none", "none"), statCaption: typeRole("3xs", "bold", "ui", "0.07em"),
      brand: typeRole("xl", "bold", "ui", "0.06em"),
      compactMicro: typeRole("8.5px"), compactCaption: typeRole("9.5px"), compactBody: typeRole("10.5px"), compactHeading: typeRole("13.5px"),
      compactSubheading: typeRole("11.5px"), compactTitle: typeRole("12.5px"),
    },
    color: { onAccent: "#10131a", onAccent2: "#10131a", onDanger: "#10131a", onSuccess: "#10131a", focusRing: "var(--accent-line)", scrim: "rgba(5,8,13,0.7)", rowHover: "var(--row-hover)", rowSelected: "var(--row-selected)" },
    border: { hairline: "hairline", control: "hairline", focus: "thick" },
    shadow: { panel: "none", modal: "lg", popup: "sm", drawer: "-10px 0 26px rgba(0,0,0,0.4)", glow: "glow", popupFilter: "md", stateWarning: "0 0 4px var(--warn)", confirm: "0 25px 50px -12px rgb(0 0 0 / 0.25)", readinessWarning: "0 0 5px rgba(193,154,85,0.6)", readinessSuccess: "0 0 5px rgba(77,154,117,0.6)", statusDot: "0 0 4px currentColor", update: "0 25px 50px -12px rgb(0 0 0 / 0.5)", inspector: "0 8px 24px rgba(0,0,0,0.5)" },
    motion: { hover: { duration: "fast", easing: "standard" }, expand: { duration: "normal", easing: "standard" }, overlay: { duration: "0ms", easing: "standard" } },
  },
};

function mergeTokens(base: unknown, custom: unknown): unknown {
  if (typeof base !== "object" || base === null) return custom === undefined ? base : custom;
  const overrides = custom as Record<string, unknown> | undefined;
  return Object.fromEntries(Object.entries(base).map(([key, value]) =>
    [key, mergeTokens(value, overrides?.[key])]));
}

export function resolveTokens(custom?: Partial<TokensV2>): ResolvedTokensV2 {
  return mergeTokens(NEUTRAL_TOKENS, custom) as ResolvedTokensV2;
}

export function parseTokens(value: unknown): Partial<TokensV2> {
  function validate(base: unknown, input: unknown, path: string): void {
    if (input === undefined) return;
    if (typeof base === "object" && base !== null) {
      if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(`${path} must be an object`);
      for (const [key, field] of Object.entries(base)) validate(field, (input as Record<string, unknown>)[key], `${path}.${key}`);
    } else if (path === "tokens.schemaVersion") {
      if (input !== 2) throw new Error("tokens.schemaVersion must be 2");
    } else if (path === "tokens.bloom" || path.startsWith("tokens.colors.")) {
      if (typeof input !== typeof base || (typeof input === "number" && !Number.isFinite(input))) throw new Error(`${path} has an invalid value`);
    } else if (typeof input !== "string" && !(typeof input === "number" && Number.isFinite(input))) {
      throw new Error(`${path} must be a string or finite number`);
    }
  }
  validate(NEUTRAL_TOKENS, value, "tokens");
  if (value === undefined) return {};
  return value as Partial<TokensV2>;
}
