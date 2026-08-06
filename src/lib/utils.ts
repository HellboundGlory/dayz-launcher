import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Relative age for the LAST PLAYED column, per design spec §6.1
 * ("3 days ago", "never").
 *
 * `last_played` is a Unix timestamp in **seconds** (SQLite `unixepoch()`),
 * not milliseconds.
 */
export function formatLastPlayed(unixSeconds: number | null): string {
  if (!unixSeconds) return "never";

  const seconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (seconds < 60) return "just now";

  const units: [number, string][] = [
    [60, "min"],
    [3600, "hr"],
    [86400, "day"],
    [604800, "week"],
    [2629746, "month"],
    [31556952, "year"],
  ];

  // Walk to the largest unit that still yields a count of at least 1.
  let chosen = units[0];
  for (const unit of units) {
    if (seconds >= unit[0]) chosen = unit;
  }

  const n = Math.floor(seconds / chosen[0]);
  return `${n} ${chosen[1]}${n === 1 ? "" : "s"} ago`;
}

/** In-game hours are "day" from this hour inclusive… */
const DAY_START = 6;
/** …until this hour exclusive. Outside it is night. */
const DAY_END = 18;

/**
 * "Nx" for a time-acceleration multiplier, trimming a whole value's fraction so
 * `4.0` renders `4x` and `4.5` renders `4.5x`.
 */
export function formatMultiplier(n: number): string {
  const trimmed = Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
  return `${trimmed}x`;
}

/**
 * Format a server's in-game clock for the TIME column.
 *
 * `in_game_time` is the "HH:MM" (24h) string from the A2S_INFO keywords. We
 * render it as a 12-hour clock with AM/PM, prefix a sun/moon glyph for the
 * current day/night phase, and suffix the time-acceleration felt right now —
 * the day multiplier while it is day, the night multiplier while it is night
 * (falling back to whichever the server reported). e.g. `☀ 3:15 PM · 4x`.
 *
 * Returns `"--:--"` when there is no clock to read.
 */
export function formatGameTime(
  inGameTime: string | null,
  dayMultiplier: number | null,
  nightMultiplier: number | null,
): string {
  if (!inGameTime) return "--:--";
  const m = /^(\d{1,2}):(\d{2})$/.exec(inGameTime);
  if (!m) return "--:--";
  const hour = Number(m[1]);
  const minute = m[2];

  const isDay = hour >= DAY_START && hour < DAY_END;
  const glyph = isDay ? "☀" : "☾";

  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  const mult = (isDay ? dayMultiplier : nightMultiplier) ?? dayMultiplier ?? nightMultiplier;
  const accel = mult != null ? ` · ${formatMultiplier(mult)}` : "";

  return `${glyph} ${h12}:${minute} ${period}${accel}`;
}

/** Region code (EU/NA/OC/SA/AS) to a full name for tooltips. */
export function regionName(code: string | null): string {
  if (!code) return "Unknown region";
  return (
    {
      EU: "Europe",
      NA: "North America",
      SA: "South America",
      AS: "Asia",
      OC: "Oceania",
    }[code] ?? code
  );
}

/**
 * Byte count as a human-readable size.
 *
 * 1024-based, labelled KB/MB/GB — matching what Steam and Windows show, since
 * these numbers sit next to Steam's own download UI. The unit table previously
 * read `["Bytes", "KiB", "MB", "GB", "TB"]`, mixing the binary label for
 * kilobytes with decimal labels for everything above it, so the same scale was
 * named two different ways depending on the size.
 */
export function formatBytes(bytes: number, decimals = 2): string {
  const UNITS = ["bytes", "KB", "MB", "GB", "TB", "PB"];

  // NaN, negatives and 0 all have no meaningful size to render. Left unguarded,
  // a negative fed `Math.log` a NaN index and produced "NaN undefined".
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";

  const k = 1024;
  // Clamped so a value past the end of the table cannot index off it.
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), UNITS.length - 1);
  const value = bytes / Math.pow(k, i);
  // Whole bytes never want a fractional part.
  const dm = i === 0 ? 0 : Math.max(0, decimals);

  return `${parseFloat(value.toFixed(dm))} ${UNITS[i]}`;
}