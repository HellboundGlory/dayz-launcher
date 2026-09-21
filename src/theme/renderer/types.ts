// The layout-file vocabulary (SPEC §5). Pure shapes: the backend validator has
// already checked every file that reaches the renderer, so nothing here is a
// runtime guard — these types only describe what a valid layout tree looks like.

/** A space token (`space.8`) or a space role (`rowX`); never a raw length. */
export type SpaceToken = string;

/** `<n>px`, `<n>%`, `auto`, `min-content`, `max-content`, or a space token. */
export type Length = string;

/** A grid track: any `Length` plus `<n>fr`. */
export type Track = string;

export type Anchor =
  | "topLeft"
  | "top"
  | "topRight"
  | "left"
  | "center"
  | "right"
  | "bottomLeft"
  | "bottom"
  | "bottomRight";

export interface PositionDef {
  anchor: Anchor;
  x?: string;
  y?: string;
}

export type Landmark = "navigation" | "main" | "complementary" | "banner" | "contentinfo";

export type SettingValue = string | number | boolean;

/** `true` always hides; the object forms hide on a settings match (§5.8). */
export type HiddenCondition =
  | true
  | { setting: string; equals: SettingValue }
  | { setting: string; not: SettingValue };

export type Align = "start" | "center" | "end" | "stretch" | "baseline";
export type Justify = "start" | "center" | "end" | "stretch" | "spaceBetween" | "spaceAround";

/** Props every node accepts (§5.5). */
export interface CommonProps {
  id?: string;
  class?: string;
  padding?: SpaceToken;
  paddingX?: SpaceToken;
  paddingY?: SpaceToken;
  paddingTop?: SpaceToken;
  paddingRight?: SpaceToken;
  paddingBottom?: SpaceToken;
  paddingLeft?: SpaceToken;
  width?: Length;
  height?: Length;
  minWidth?: Length;
  maxWidth?: Length;
  minHeight?: Length;
  maxHeight?: Length;
  grow?: number;
  shrink?: number;
  basis?: Length;
  area?: string;
  position?: PositionDef;
  hidden?: HiddenCondition;
  landmark?: Landmark;
  context?: "selection" | "modSelection" | "modFilterPreview";
  empty?: LayoutNode;
  collapsible?: { default?: "expanded" | "collapsed"; collapsed: LayoutNode };
  resizable?: { edge: "left" | "right" | "top" | "bottom"; min?: Length; max?: Length };
  column?: string;
}

export interface StackNode extends CommonProps {
  type: "stack";
  direction?: "row" | "column";
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  gap?: SpaceToken;
  children: LayoutNode[];
}

export interface GridNode extends CommonProps {
  type: "grid";
  columns?: Track[];
  rows?: Track[];
  areas?: string[];
  gap?: SpaceToken;
  columnGap?: SpaceToken;
  rowGap?: SpaceToken;
  alignItems?: Align;
  justifyItems?: Align;
  children: LayoutNode[];
}

export interface BoxNode extends CommonProps {
  type: "box";
  children: LayoutNode[];
}

export interface ScrollNode extends CommonProps {
  type: "scroll";
  axis?: "y" | "x";
  children: LayoutNode[];
}

export type TextRole =
  | "display"
  | "heading"
  | "subheading"
  | "body"
  | "label"
  | "caption"
  | "micro"
  | "button"
  | "chip"
  | "data";

export interface TextNode extends CommonProps {
  type: "text";
  value: string;
  role?: TextRole;
}

export interface ImageNode extends CommonProps {
  type: "image";
  /** A package image path; mutually exclusive with `icon`. */
  src?: string;
  /** A launcher icon name from the §6.5 allowlist. */
  icon?: string;
  fit?: "cover" | "contain";
}

export interface OutletNode extends CommonProps {
  type: "outlet";
  name: "view" | "modals";
}

export interface ElementNode extends CommonProps {
  element: string;
  options?: Record<string, unknown>;
  label?: string;
}

export interface SurfaceNode extends CommonProps {
  surface: string;
}

export interface TabDef {
  id: string;
  label: LayoutNode;
  content: LayoutNode;
}

export interface TabsNode extends CommonProps {
  type: "tabs";
  id: string;
  tabs: TabDef[];
  orientation?: "horizontal" | "vertical";
}

export interface AccordionSectionDef {
  id: string;
  header: LayoutNode;
  body: LayoutNode;
}

export interface AccordionNode extends CommonProps {
  type: "accordion";
  id: string;
  mode: "single" | "multiple";
  initial: "none" | "first";
  sections: AccordionSectionDef[];
}

export type ContainerNode =
  | StackNode
  | GridNode
  | BoxNode
  | ScrollNode
  | TabsNode
  | AccordionNode;

export type LayoutNode =
  | ContainerNode
  | TextNode
  | ImageNode
  | OutletNode
  | ElementNode
  | SurfaceNode;

export interface LayoutVariant {
  minWidth: number;
  root: LayoutNode;
}

export interface ColumnDef {
  id: string;
  label?: string;
  width: string;
  minWidth?: string;
  maxWidth?: string;
  align?: "start" | "center" | "end";
  sort?: string;
  /** Default `true`. Only a column with a px `width` resizes. */
  resizable?: boolean;
  /** A registry element id rendered in the header cell instead of the label. */
  headerElement?: string;
}

export interface LayoutFile {
  schemaVersion: number;
  root?: LayoutNode;
  variants?: LayoutVariant[];
  columns?: ColumnDef[];
  header?: boolean;
  row?: LayoutNode;
  empty?: LayoutNode;
  placement?: ModalPlacement | PopupPlacement;
  backdrop?: "dim" | "none";
  presentation?: SettingsPresentation;
  overflowX?: "clip" | "scroll";
  estimatedRowHeight?: string;
}

export interface ModalPlacement {
  mode: "center" | "region" | "anchor";
  region?: string;
  anchor?: Anchor;
  x?: string;
  y?: string;
}

export interface ModalLayoutFile {
  schemaVersion: number;
  placement?: ModalPlacement;
  backdrop?: "dim" | "none";
  root: LayoutNode;
}

export interface PopupPlacement {
  mode: "anchored" | "region" | "inline";
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  offset?: string;
  maxHeight?: string;
}

export interface PopupLayoutFile {
  schemaVersion: number;
  placement?: PopupPlacement;
  root: LayoutNode;
}

export interface SettingsPresentation {
  mode: "overlay" | "view" | "panel";
  region?: string;
  backdropClose?: boolean;
}

export interface SettingsLayoutFile {
  schemaVersion: number;
  presentation?: SettingsPresentation;
  root: LayoutNode;
}

/** What `renderElement` receives: the two host-owned leaf shapes. */
export type HostNode = ElementNode | SurfaceNode;

