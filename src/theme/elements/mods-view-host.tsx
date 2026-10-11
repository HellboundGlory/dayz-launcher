import { useModsLifecycle } from "@/hooks/use-mods-lifecycle";
import { LayoutRenderer } from "../renderer";
import type { SettingsValues } from "../renderer/props";
import type { LayoutFile } from "../renderer/types";

/** A theme's `layout/views/mods.json`; mounts `useModsLifecycle`. */
export function ModsViewHost({
  file,
  themeId,
  settings,
}: {
  file: LayoutFile;
  themeId: string;
  settings?: SettingsValues;
}) {
  useModsLifecycle();
  return <LayoutRenderer file={file} themeId={themeId} settings={settings} />;
}
