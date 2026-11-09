import { getMemoryMapStatus } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { useMemoryMapStore } from "@/stores/memory-map-store";

export function memoryMapCommands(recommended: number): { raise: string; keep: string } {
  return {
    raise: `sudo sysctl -w vm.max_map_count=${recommended}`,
    keep: `echo 'vm.max_map_count=${recommended}' | sudo tee /etc/sysctl.d/80-dayz.conf`,
  };
}

/**
 * True when the Join may go on. Warns once per Join when the Linux memory map
 * limit is too low for DayZ, and never fails a Join over a check it couldn't make.
 */
export async function checkMemoryMap(): Promise<boolean> {
  const settings = useSettingsStore.getState();
  if (!settings.memoryMapWarning) return true;

  const status = await getMemoryMapStatus().catch(() => null);
  if (!status) return true;

  const { join, dontWarn } = await useMemoryMapStore.getState().ask(status);
  if (dontWarn) settings.setSetting("memoryMapWarning", false);
  return join;
}
