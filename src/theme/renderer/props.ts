// Token, style and prop resolution for the layout renderer. Everything a theme
// writes as a token name becomes a `var(--t-*)` reference here; the CSS
// variables themselves are written to the window root by `apply.ts`.

import type { CSSProperties } from "react";
import type {
  Align,
  CommonProps,
  HiddenCondition,
  Justify,
  Landmark,
  Length,
  PositionDef,
  SettingValue,
  SpaceToken,
} from "./types";

/** `space.8` -> `var(--t-space-8)`, role `rowX` -> `var(--t-space-rowX)`. */
export function resolveSpace(token: SpaceToken): string {
  const step = token.startsWith("space.") ? token.slice("space.".length) : token;
  return `var(--t-space-${step})`;
}

/** A sizing length: a space token resolves, everything else passes through. */
export function resolveLength(value: Length): string {
  return value.startsWith("space.") ? resolveSpace(value) : value;
}

export const ALIGN: Record<Align, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};

export const JUSTIFY: Record<Justify, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  spaceBetween: "space-between",
  spaceAround: "space-around",
};

export const LANDMARK_TAGS: Record<Landmark, "nav" | "main" | "aside" | "header" | "footer"> = {
  navigation: "nav",
  main: "main",
  complementary: "aside",
  banner: "header",
  contentinfo: "footer",
};

export function paddingStyle(props: CommonProps): CSSProperties {
  const s: CSSProperties = {};
  if (props.padding !== undefined) s.padding = resolveSpace(props.padding);
  if (props.paddingX !== undefined) {
    s.paddingLeft = resolveSpace(props.paddingX);
    s.paddingRight = resolveSpace(props.paddingX);
  }
  if (props.paddingY !== undefined) {
    s.paddingTop = resolveSpace(props.paddingY);
    s.paddingBottom = resolveSpace(props.paddingY);
  }
  if (props.paddingTop !== undefined) s.paddingTop = resolveSpace(props.paddingTop);
  if (props.paddingRight !== undefined) s.paddingRight = resolveSpace(props.paddingRight);
  if (props.paddingBottom !== undefined) s.paddingBottom = resolveSpace(props.paddingBottom);
  if (props.paddingLeft !== undefined) s.paddingLeft = resolveSpace(props.paddingLeft);
  return s;
}

export function sizingStyle(props: CommonProps): CSSProperties {
  const s: CSSProperties = {};
  if (props.width !== undefined) s.width = resolveLength(props.width);
  if (props.height !== undefined) s.height = resolveLength(props.height);
  if (props.minWidth !== undefined) s.minWidth = resolveLength(props.minWidth);
  if (props.maxWidth !== undefined) s.maxWidth = resolveLength(props.maxWidth);
  if (props.minHeight !== undefined) s.minHeight = resolveLength(props.minHeight);
  if (props.maxHeight !== undefined) s.maxHeight = resolveLength(props.maxHeight);
  if (props.grow !== undefined) s.flexGrow = props.grow;
  if (props.shrink !== undefined) s.flexShrink = props.shrink;
  if (props.basis !== undefined) s.flexBasis = resolveLength(props.basis);
  return s;
}

/** An anchored node pins to the side(s) it names and moves inward by the
 * offset on that same side; a centred axis rides its offset inside the
 * centring transform, so a negative value nudges the node outward. */
export function positionStyle({ anchor, x, y }: PositionDef): CSSProperties {
  const style: CSSProperties = { position: "absolute" };
  const shifts: string[] = [];
  const isTop = anchor.startsWith("top");
  const isBottom = anchor.startsWith("bottom");
  if (isTop || isBottom) {
    style[isTop ? "top" : "bottom"] = y ?? 0;
  } else {
    style.top = "50%";
    shifts.push(`translateY(${y === undefined ? "-50%" : `calc(-50% + ${y})`})`);
  }
  const lower = anchor.toLowerCase();
  const isLeft = lower.endsWith("left");
  const isRight = lower.endsWith("right");
  if (isLeft || isRight) {
    style[isLeft ? "left" : "right"] = x ?? 0;
  } else {
    style.left = "50%";
    shifts.push(`translateX(${x === undefined ? "-50%" : `calc(-50% + ${x})`})`);
  }
  if (shifts.length > 0) style.transform = shifts.join(" ");
  return style;
}

export type SettingsValues = Record<string, SettingValue>;

export function isHidden(hidden: HiddenCondition | undefined, settings: SettingsValues): boolean {
  if (hidden === undefined) return false;
  if (hidden === true) return true;
  const current = settings[hidden.setting];
  return "equals" in hidden ? current === hidden.equals : current !== hidden.not;
}

export interface RenderedAttrs {
  id?: string;
  className?: string;
  style?: CSSProperties;
  "data-state"?: string;
  "data-region"?: string;
}

/** Merges an extra style (e.g. column placement) into already-computed attrs. */
export function withStyle(attrs: RenderedAttrs, extra?: CSSProperties): RenderedAttrs {
  if (extra === undefined) return attrs;
  return { ...attrs, style: { ...attrs.style, ...extra } };
}

/** The id, class and non-layout style every node shares. `hostsPositioned`
 * makes a container the containing block for its anchored children. */
export function commonAttrs(node: CommonProps, hostsPositioned = false): RenderedAttrs {
  const style: CSSProperties = { ...paddingStyle(node), ...sizingStyle(node) };
  if (node.area !== undefined) style.gridArea = node.area;
  if (node.position !== undefined) Object.assign(style, positionStyle(node.position));
  else if (hostsPositioned) style.position = "relative";
  return {
    id: node.id,
    "data-region": node.id,
    className: node.class,
    style: Object.keys(style).length > 0 ? style : undefined,
  };
}
