export interface LaunchToggle {
  id: string;
  name: string;
  flag: string;
}

export const LAUNCH_TOGGLES: LaunchToggle[] = [
  { id: "skipIntro", name: "Skip intro", flag: "-skipIntro" },
  { id: "noSplash", name: "No splash screen", flag: "-nosplash" },
  { id: "noPause", name: "Keep running in the background", flag: "-noPause" },
  { id: "windowed", name: "Windowed", flag: "-window" },
];

function sameFlag(line: string, flag: string): boolean {
  return line.trim().toLowerCase() === flag.toLowerCase();
}

export function hasLaunchFlag(params: string[], flag: string): boolean {
  return params.some((line) => sameFlag(line, flag));
}

export function setLaunchFlag(params: string[], flag: string, on: boolean): string[] {
  if (!on) return params.filter((line) => !sameFlag(line, flag));
  if (hasLaunchFlag(params, flag)) return params;
  return [...params, flag];
}
