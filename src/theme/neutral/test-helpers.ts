import { expect } from "vitest";
import { resolveRequiredElements } from "../fallback/use-visibility-check";
import { isElementInLayout } from "../layout-query";
import { REGISTRY } from "../registry";
import type { LayoutFile } from "../renderer/types";

export function expectRequiredPlaced(context: string, layout: LayoutFile): void {
  // The same extra contexts the runtime check adds: `modal` for any modal, `withJoin` wherever Join is required outside list rows.
  const contexts = [context];
  if (context.startsWith("modal:")) contexts.push("modal");
  const joinContexts = (REGISTRY.elements["server.join"]?.required ?? []).filter((c) => !c.startsWith("list:"));
  if (joinContexts.includes(context)) contexts.push("withJoin");
  const required = [...resolveRequiredElements(contexts).keys()];
  expect(required.length).toBeGreaterThan(0);
  expect(required.filter((id) => !isElementInLayout(layout, id))).toEqual([]);
}
