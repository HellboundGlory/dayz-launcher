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

export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = [
    "Bytes",
    "KiB",
    "MB",
    "GB",
    "TB",
  ];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}