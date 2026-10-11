import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Deterministic fallback tile for a mod with no (or a broken) preview image. */
export function GeneratedThumbnail({
  id,
  title,
  className,
  ...rest
}: { id: string; title: string } & HTMLAttributes<HTMLSpanElement>) {
  const hue = hashHue(id);
  return (
    <span
      {...rest}
      className={cn("flex h-full w-full items-center justify-center font-extrabold text-white/85", className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 42% 32%), hsl(${(hue + 42) % 360} 48% 20%))` }}
    >
      {initials(title)}
    </span>
  );
}
