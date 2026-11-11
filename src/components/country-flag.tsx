import type { CSSProperties } from "react";
import { flagUrl } from "@/lib/country-flag";

/** A small 3:2 flag image for a country code; nothing at all when the code has no flag. */
export function CountryFlag({
  code,
  className,
  style,
}: {
  code: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const src = flagUrl(code);
  if (!src) return null;
  return (
    <img
      data-part="flag"
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={
        className ??
        "inline-block h-[0.9em] w-auto shrink-0 border border-line align-[-0.125em] [border-radius:var(--t-radius-chip)]"
      }
      style={style}
    />
  );
}
