import { useContext } from "react";
import type { LucideIcon } from "lucide-react";
import { resolveThemeAsset } from "../asset-resolver";
import { ICONS } from "../renderer/leaves";
import { RenderContext } from "../renderer/node-renderer";

/** An element's `icon` option: a launcher icon name, a package image, or "none". */
export function OptionIcon({
  icon,
  fallback: Fallback,
  className,
}: {
  icon: unknown;
  fallback: LucideIcon;
  className?: string;
}) {
  const { themeId } = useContext(RenderContext);
  if (icon === "none") return null;
  if (typeof icon === "string" && icon.startsWith("images/")) {
    return <img src={resolveThemeAsset(themeId, icon)} alt="" aria-hidden className={className} />;
  }
  const Icon = (typeof icon === "string" && ICONS[icon]) || Fallback;
  return <Icon className={className} aria-hidden />;
}
