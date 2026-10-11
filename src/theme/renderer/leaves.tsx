// The leaf primitives a theme composes directly (§5.4): plain text, a
// decorative image or launcher icon, and the shell's named outlets.

import type { CSSProperties, ReactNode } from "react";
import {
  AppWindow,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleCheck,
  Clock,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FileArchive,
  FileOutput,
  Folder,
  FolderOpen,
  Funnel,
  Gamepad2,
  Globe,
  Inbox,
  Info,
  ListTree,
  LoaderCircle,
  Minus,
  Moon,
  Package,
  Palette,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Star,
  Sun,
  ThumbsUp,
  Trash,
  TriangleAlert,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { resolveThemeAsset } from "../asset-resolver";
import type { RenderedAttrs } from "./props";
import type { ImageNode, OutletNode, TextNode, TextRole } from "./types";

/** The §6.5 allowlist, keyed by the launcher icon name a theme writes. */
export const ICONS: Record<string, LucideIcon> = {
  alertTriangle: TriangleAlert,
  appWindow: AppWindow,
  arrowRight: ArrowRight,
  ban: Ban,
  check: Check,
  checkCircle: CircleCheck,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronsLeft: ChevronsLeft,
  chevronsRight: ChevronsRight,
  clock: Clock,
  copy: Copy,
  download: Download,
  externalLink: ExternalLink,
  fileArchive: FileArchive,
  fileOutput: FileOutput,
  filter: Funnel,
  folder: Folder,
  folderOpen: FolderOpen,
  gamepad: Gamepad2,
  globe: Globe,
  inbox: Inbox,
  info: Info,
  listTree: ListTree,
  loader: LoaderCircle,
  minus: Minus,
  moon: Moon,
  moreHorizontal: Ellipsis,
  package: Package,
  palette: Palette,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  rotateCcw: RotateCcw,
  search: Search,
  settings: Settings,
  square: Square,
  star: Star,
  sun: Sun,
  thumbsUp: ThumbsUp,
  trash: Trash,
  upload: Upload,
  users: Users,
  x: X,
};

/** A text role's heading semantics; anything not a heading is inline/flow. */
const TEXT_TAGS: Record<TextRole, "h1" | "h2" | "h3" | "p" | "span"> = {
  display: "h1",
  heading: "h2",
  subheading: "h3",
  body: "p",
  label: "span",
  caption: "span",
  micro: "span",
  button: "span",
  chip: "span",
  data: "span",
};

export function TextLeaf({ node, attrs }: { node: TextNode; attrs: RenderedAttrs }) {
  // A role is not checked at the type boundary: theme JSON reaches here as-is,
  // and a name without a tag would render as an invalid component.
  const role: TextRole =
    node.role !== undefined && Object.prototype.hasOwnProperty.call(TEXT_TAGS, node.role)
      ? node.role
      : "body";
  const Tag = TEXT_TAGS[role];
  const style: CSSProperties = {
    fontFamily: `var(--t-type-${role}-family)`,
    fontSize: `var(--t-type-${role}-size)`,
    fontWeight: `var(--t-type-${role}-weight)` as CSSProperties["fontWeight"],
    letterSpacing: `var(--t-type-${role}-tracking)`,
    lineHeight: `var(--t-type-${role}-leading)`,
    ...attrs.style,
  };
  return (
    <Tag id={attrs.id} className={attrs.className} style={style} role={attrs.role}>
      {node.value}
    </Tag>
  );
}

export function ImageLeaf({ node, themeId, attrs }: { node: ImageNode; themeId: string; attrs: RenderedAttrs }) {
  if (node.icon !== undefined) {
    const Icon = ICONS[node.icon];
    if (Icon === undefined) return null;
    return <Icon id={attrs.id} className={attrs.className} style={attrs.style} role={attrs.role} aria-hidden />;
  }
  if (node.src === undefined) return null;
  const style: CSSProperties = {
    ...(node.fit !== undefined && { objectFit: node.fit }),
    ...attrs.style,
  };
  return (
    <img
      id={attrs.id}
      className={attrs.className}
      style={Object.keys(style).length > 0 ? style : undefined}
      role={attrs.role}
      src={resolveThemeAsset(themeId, node.src)}
      alt=""
      aria-hidden
    />
  );
}

export function OutletLeaf({
  node,
  outlets,
  attrs,
}: {
  node: OutletNode;
  outlets: Record<string, ReactNode>;
  attrs: RenderedAttrs;
}) {
  const content = outlets[node.name] ?? null;
  if (attrs.id === undefined && attrs.className === undefined && attrs.style === undefined) {
    return <>{content}</>;
  }
  return (
    <div id={attrs.id} className={attrs.className} style={attrs.style} role={attrs.role}>
      {content}
    </div>
  );
}
