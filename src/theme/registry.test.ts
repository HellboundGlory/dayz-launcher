import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGISTRY, type ElementDef, type OptionDef, type Registry } from "./registry";

const elementsDoc = readFileSync(new URL("../../docs/theme-system/ELEMENTS.md", import.meta.url), "utf8");
const specDoc = readFileSync(new URL("../../docs/theme-system/SPEC.md", import.meta.url), "utf8");
const kinds = ["display", "input", "action", "nav", "notice", "list", "block"];
const subjects = ["server", "mod", "serverMod", "modServer", "workshopMod"];
const code = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
const scalar = (text: string) => /^\d+$/.test(text) ? Number(text) : text;
const rows = (doc: string) => doc.split("\n").filter((line) => line.startsWith("|"))
  .map((line) => line.slice(1, line.lastIndexOf("|")).split("|").map((cell) => cell.trim()));
const table = rows(elementsDoc);
const elementRows = table.filter((row) => row.length === 8 && kinds.includes(row[1]));

function optionsFromTable(text: string, previous: Record<string, ElementDef>): Record<string, OptionDef> {
  const inherited = /^as `([^`]+)`/.exec(text);
  const options: Record<string, OptionDef> = inherited ? structuredClone(previous[inherited[1]].options) : {};
  for (const token of code(text)) {
    if (text.includes("booleans") && token.startsWith("show") && !token.includes(":")) {
      options[token] = { type: "boolean", default: token !== "showBattleye" };
    } else if (token.includes(": ")) {
      const [name, raw] = token.split(": ");
      const match = / \(([^)]+)\)$/.exec(raw);
      const values = match ? raw.slice(0, match.index) : raw;
      if (values === "true / false") {
        options[name] = { type: "boolean", default: match?.[1] === "true" };
      } else if (values === "region id") {
        options[name] = { type: "region" };
      } else if (values === "token" || values === "length") {
        options[name] = { type: values, ...(match ? { default: match[1] } : {}) };
      } else {
        options[name] = { type: "enum", values: values.split(" / ").map(scalar), ...(match ? { default: scalar(match[1]) } : {}) };
      }
    } else if (token === "icon" || token === "label") {
      options[token] = { type: token === "icon" ? "icon" : "text" };
    } else if (token === "rowGap") {
      options.rowGap = { type: "token", default: "none" };
    } else if (token.startsWith("estimatedRowHeight (")) {
      options.estimatedRowHeight = { type: "length", default: token.slice(token.indexOf("(") + 1, -1) };
    }
  }
  return options;
}

function documentedElements(doc: string): Record<string, ElementDef> {
  const result: Record<string, ElementDef> = {};
  for (const row of rows(doc).filter((r) => r.length === 8 && kinds.includes(r[1]))) {
    const [rawId, kind, placement, requirement, count, rawOptions, rawParts, rawStates] = row;
    const id = code(rawId)[0];
    const where = placement.replace(/`/g, "").split(", ");
    if (id === "server.info" || id === "server.menu") where.splice(1);
    if (id === "server.deselect") where.splice(0, where.length, "selection");
    if (id === "popup.close") where.splice(0, where.length, "popup");
    const simpleRequirements: Record<string, string[]> = {
      "—": [], views: ["views"], "views+settings": ["views+settings"],
      "views+settings (at least one)": ["views+settings"], browser: ["view:browser"], mods: ["view:mods"],
      settings: ["settings"], "with join": ["withJoin"], "modal (every themeable modal)": ["modal"],
      "popups placed in a region or inline": ["popup:region", "popup:inline"], popup: where,
    };
    const required = simpleRequirements[requirement] ?? [
      ...[...requirement.matchAll(/row of `list\.([^`]+)`/g)].map((m) => `list:${m[1]}/row`),
      ...[...requirement.matchAll(/modal `([^`]+)`/g)].map((m) => `modal:${m[1]}`),
    ];
    expect(required.length > 0 || requirement === "—", `Unparsed requirement: ${requirement}`).toBe(true);
    const options = optionsFromTable(rawOptions, result);
    const parts = rawParts === "—" ? [] : rawParts.split(", ");
    const freeLabel = required.length === 0 && (parts.includes("label") || "label" in options);
    if (freeLabel) options.label ??= { type: "text" };
    if (required.length) delete options.label;
    if (parts.includes("icon")) options.icon ??= { type: "icon" };
    if (id === "app.collapseToggle") options.label = { type: "text", default: "sidebar" };
    if (id === "server.join") options.icon = { type: "icon", default: "play" };
    const states = code(rawStates);
    const prefix = id.split(".")[0];
    const subject = subjects.includes(prefix) ? prefix : id === "list.serverMods" ? "server" : id === "list.modServers" ? "mod" : undefined;
    if (prefix === "server" && !states.includes("offline")) states.push("offline");
    if (prefix === "mod" && !states.includes("disabled")) states.push("disabled");
    result[id] = {
      kind: kind as ElementDef["kind"], ...(subject ? { subject: subject as ElementDef["subject"] } : {}),
      where, required, multiplicity: ({ n: "many", "1": "perComposition", "1/ctx": "perContext", "1 per target region": "perComposition" } as const)[count as "n" | "1" | "1/ctx" | "1 per target region"],
      options, freeLabel, parts, states, since: "2.0", aliases: [],
    };
    if (placement.includes("not the server info modal")) result[id].excludedWhere = ["modal:serverInfo"];
    if (placement.includes("not a popup")) result[id].excludedWhere = ["popup"];
    if (count === "1 per target region") result[id].multiplicityScope = "region";
  }
  result["server.join"].fallbackPlacement = { "list:servers/row": "append", "modal:serverInfo": "append" };
  result["server.actionNotice"].fallbackPlacement = {
    "list:servers/row": "afterElement:server.join", "modal:serverInfo": "afterElement:server.join", withJoin: "afterElement:server.join",
  };
  return result;
}

function documentedSurfaces(doc: string) {
  return Object.fromEntries(rows(doc).filter((r) => r.length === 3 && r[0].startsWith("`surface.")).map(([rawId, where, contents]) => {
    const contains = code(contents).flatMap((id) => id === "nav.*"
      ? elementRows.map((r) => code(r[0])[0]).filter((id) => id.startsWith("nav.")) : [id]);
    if (contents.includes("the four hide toggles")) {
      contains.splice(contains.indexOf("filter.reset"), 0, ...elementRows.map((r) => code(r[0])[0]).filter((id) => id.startsWith("filter.hide")));
    }
    return [code(rawId)[0], { where: where.split(", "), contains }];
  }));
}

function assertParity(registry: Registry, doc = elementsDoc) {
  expect(registry.elements).toEqual(documentedElements(doc));
  expect(registry.surfaces).toEqual(documentedSurfaces(doc));
}

describe("shared v2 registry", () => {
  it("matches every element definition and surface in ELEMENTS.md, in both directions", () => {
    expect(elementRows).toHaveLength(175);
    assertParity(REGISTRY);
  });

  it("rejects missing, extra, or changed definitions on either side of the contract", () => {
    const missing = structuredClone(REGISTRY);
    delete missing.elements["filter.search"];
    expect(() => assertParity(missing)).toThrow();
    const extra = structuredClone(REGISTRY);
    extra.elements["app.unknown"] = extra.elements["app.logo"];
    expect(() => assertParity(extra)).toThrow();
    const changed = structuredClone(REGISTRY);
    changed.elements["server.join"].options.wording = { type: "enum", values: ["join"] };
    expect(() => assertParity(changed)).toThrow();
    const surface = structuredClone(REGISTRY);
    surface.surfaces["surface.windowControls"].contains.pop();
    expect(() => assertParity(surface)).toThrow();
    expect(() => assertParity(REGISTRY, elementsDoc.replace("`app.minimize` | action", "`app.minimize` | display"))).toThrow();
    expect(() => assertParity(REGISTRY, elementsDoc.replace("`surface.windowControls` | app", "`surface.windowControls` | mods"))).toThrow();
  });

  it("has valid option defaults and resolvable references", () => {
    expect(REGISTRY.registryVersion).toBe("2.0");
    for (const [id, element] of Object.entries(REGISTRY.elements)) {
      expect(kinds, id).toContain(element.kind);
      expect(["many", "perComposition", "perContext"], id).toContain(element.multiplicity);
      expect(element.where.length, id).toBeGreaterThan(0);
      expect(element.freeLabel, id).toBe("label" in element.options);
      if (element.required.length) expect(element.freeLabel, id).toBe(false);
      for (const option of Object.values(element.options)) {
        expect(["enum", "boolean", "icon", "text", "length", "token", "region"], id).toContain(option.type);
        if (option.type === "enum") {
          expect(option.values.length, id).toBeGreaterThan(0);
          if (option.default !== undefined) expect(option.values, id).toContain(option.default);
        } else if ("default" in option) {
          expect(typeof option.default, id).toBe(option.type === "boolean" ? "boolean" : "string");
          if (option.type === "icon") expect(REGISTRY.icons, id).toContain(option.default);
        }
      }
    }
    for (const surface of Object.values(REGISTRY.surfaces)) {
      for (const id of surface.contains) expect(REGISTRY.elements).toHaveProperty(id);
    }
    for (const [id, list] of Object.entries(REGISTRY.lists)) {
      expect(REGISTRY.elements[id].kind).toBe("list");
      expect(subjects).toContain(list.subject);
      if (list.defaultSort) expect(list.sortKeys).toContain(list.defaultSort.key);
    }
    for (const modal of Object.values(REGISTRY.modals)) {
      for (const id of modal.required) expect(REGISTRY.elements[id]).toBeDefined();
    }
    for (const popup of Object.values(REGISTRY.popups)) {
      expect(REGISTRY.elements[popup.openedBy]).toBeDefined();
      for (const id of popup.requiredContents) expect(REGISTRY.elements[id]).toBeDefined();
    }
    expect(Object.keys(REGISTRY.blocks)).toEqual(elementRows.filter((r) => r[1] === "block").map((r) => code(r[0])[0]));
    for (const [id, block] of Object.entries(REGISTRY.blocks)) expect(block.where).toEqual(REGISTRY.elements[id].where);
  });

  it("matches list subjects, templates, sort keys, defaults and row states", () => {
    const listRows = table.filter((r) => r.length === 3 && r[2].startsWith("`layout/lists/"));
    expect(Object.keys(REGISTRY.lists).sort()).toEqual(listRows.map((r) => code(r[0])[0]).sort());
    for (const [rawId, subject, template] of listRows) {
      const id = code(rawId)[0];
      const list = REGISTRY.lists[id];
      expect(list.subject).toBe(subject);
      expect(list.template).toBe(code(template)[0]);
      const sortRow = table.find((r) => r.length === 3 && r[0] === rawId && (r[1].startsWith("`") || r[1].startsWith("none:")))!;
      expect(list.sortKeys).toEqual(code(sortRow[1]));
      expect(list.defaultSort).toEqual(sortRow[2] === "—" ? undefined : {
        key: code(sortRow[2])[0], direction: sortRow[2].includes("descending") ? "descending" : "ascending",
      });
      const stateRow = table.find((r) => r.length === 2 && r[0] === rawId && r[1].startsWith("`"))!;
      expect(list.states).toEqual(code(stateRow[1]));
    }
  });

  it("matches all modal and popup contracts and the complete SPEC icon allowlist", () => {
    const modals = Object.fromEntries(table.filter((r) => r.length === 4 && r[1].startsWith("`layout/modals/")).map(([, rawFile, subject, required]) => {
      const file = code(rawFile)[0];
      return [file.split("/").pop()!.replace(".json", ""), { file, subject: subject === "—" ? null : subject, required: code(required) }];
    }));
    expect(REGISTRY.modals).toEqual(modals);
    const popupSection = elementsDoc.split("## popup: the themeable popups")[1].split("| Id | Kind |")[0];
    const popups = Object.fromEntries(rows(popupSection).filter((r) => r[0].startsWith("`")).map(([id, openedBy, required]) => [
      code(id)[0], { openedBy: code(openedBy)[0], requiredContents: code(required) },
    ]));
    expect(REGISTRY.popups).toEqual(popups);
    const iconLine = specDoc.split("\n").find((line) => line.trimStart().startsWith("`alertTriangle`"))!;
    expect(REGISTRY.icons).toEqual(code(iconLine));
    expect(new Set(REGISTRY.icons).size).toBe(44);
  });
});
