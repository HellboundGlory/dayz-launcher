/** ThemeCard is stubbed to serialize its props: the node test env has no DOM
 * and the real card's menu is closed in static markup. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGridEntries, ThemeGrid } from "./ThemeGrid";
import type { ThemeSummary } from "@/types/theme";

vi.mock("./ThemeCard", () => ({
  ThemeCard: ({
    name,
    builtin,
    onActivate,
    onDuplicate,
    onExport,
    onRequestDelete,
    incompatible,
    incompatibleReason,
  }: {
    name: string;
    builtin: boolean;
    onActivate?: () => void;
    onDuplicate?: () => void;
    onExport?: () => void;
    onRequestDelete?: () => void;
    incompatible?: boolean;
    incompatibleReason?: string;
  }) => (
    <p
      data-name={name}
      data-builtin={String(builtin)}
      data-has-activate={onActivate !== undefined ? "yes" : "no"}
      data-has-duplicate={onDuplicate !== undefined ? "yes" : "no"}
      data-has-export={onExport !== undefined ? "yes" : "no"}
      data-has-delete={onRequestDelete !== undefined ? "yes" : "no"}
      data-incompatible={String(Boolean(incompatible))}
      data-reason={incompatibleReason ?? ""}
    />
  ),
}));

const summary = (id: string, name: string): ThemeSummary => ({
  id,
  name,
  author: "Tetra Team",
  version: "1.0.0",
  themeApi: "1",
  minimumLauncherVersion: "2.6.0",
  tier: "expert",
  description: "",
  preview: null,
  tags: [],
  capabilities: [],
});

const scanOrder = [summary("builtin.tactical", "Tactical"), summary("local.myskin", "My Skin")];

const renderGrid = (installed: ThemeSummary[]) =>
  renderToStaticMarkup(
    <ThemeGrid
      activeId="neutral"
      installedThemes={installed}
      themeFiles={{}}
      onActivate={() => {}}
      onDuplicate={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
    />,
  );

const cards = (html: string) =>
  [...html.matchAll(/<p ([^>]+)><\/p>/g)].map(([, attrs]) => {
    const get = (attr: string) => attrs.match(new RegExp(`${attr}="([^"]*)"`))?.[1] ?? "";
    return {
      name: get("data-name"),
      builtin: get("data-builtin"),
      hasActivate: get("data-has-activate"),
      hasDuplicate: get("data-has-duplicate"),
      hasExport: get("data-has-export"),
      hasDelete: get("data-has-delete"),
      incompatible: get("data-incompatible"),
      reason: get("data-reason"),
    };
  });

describe("buildGridEntries", () => {
  it("orders neutral, then the showcase theme, then user themes", () => {
    expect(buildGridEntries(scanOrder).map((e) => e.id)).toEqual([
      "neutral",
      "builtin.tactical",
      "local.myskin",
    ]);
  });

  it("marks the showcase theme builtin and keeps a user theme custom", () => {
    const entries = buildGridEntries(scanOrder);
    expect(entries[1]).toMatchObject({ id: "builtin.tactical", builtin: true });
    expect(entries[2]).toMatchObject({ id: "local.myskin", builtin: false });
  });

  it("drops the showcase id when the backend has not seeded it, without error", () => {
    const entries = buildGridEntries([summary("local.x", "X")]);
    expect(entries.map((e) => e.id)).toEqual(["neutral", "local.x"]);
  });

  it("prefers the first previews entry over the legacy preview field", () => {
    const t = { ...summary("local.x", "X"), preview: "preview.png", previews: [{ file: "previews/one.png", caption: "One" }] };
    const entries = buildGridEntries([t]);
    expect(entries.find((e) => e.id === "local.x")).toMatchObject({ preview: "previews/one.png" });
  });

  it("falls back to the legacy preview field when previews is absent or empty", () => {
    const withoutField = summary("local.x", "X");
    const withEmpty = { ...summary("local.y", "Y"), previews: [] };
    const entries = buildGridEntries([{ ...withoutField, preview: "preview.png" }, { ...withEmpty, preview: "preview.png" }]);
    expect(entries.find((e) => e.id === "local.x")).toMatchObject({ preview: "preview.png" });
    expect(entries.find((e) => e.id === "local.y")).toMatchObject({ preview: "preview.png" });
  });

  it("yields no preview when neither field is set", () => {
    const entries = buildGridEntries([summary("local.x", "X")]);
    expect(entries.find((e) => e.id === "local.x")).toMatchObject({ preview: undefined });
  });

  it("carries an incompatible theme's flag and reason through, still present in the grid", () => {
    const t = { ...summary("local.old", "Old Skin"), incompatible: true, incompatibleReason: "v1 theme" };
    const entries = buildGridEntries([t]);
    expect(entries.find((e) => e.id === "local.old")).toMatchObject({
      incompatible: true,
      incompatibleReason: "v1 theme",
    });
  });

  it("leaves incompatible undefined for an ordinary theme", () => {
    const entries = buildGridEntries([summary("local.x", "X")]);
    expect(entries.find((e) => e.id === "local.x")).toMatchObject({
      incompatible: undefined,
      incompatibleReason: undefined,
    });
  });
});

describe("ThemeGrid render", () => {
  it("shows page 1 as neutral plus the showcase theme, without export or delete", () => {
    const page = cards(renderGrid(scanOrder));
    expect(page.map((c) => c.name)).toEqual(["Neutral", "Tactical", "My Skin"]);
    for (const card of page.slice(0, 2)) {
      expect(card.builtin).toBe("true");
      expect(card.hasExport).toBe("no");
      expect(card.hasDelete).toBe("no");
    }
  });

  it("still offers export and delete for an ordinary installed theme", () => {
    const page = cards(renderGrid([summary("local.myskin", "My Skin")]));
    expect(page).toMatchObject([
      { name: "Neutral", builtin: "true", hasExport: "no", hasDelete: "no" },
      { name: "My Skin", builtin: "false", hasExport: "yes", hasDelete: "yes" },
    ]);
  });

  it("lists an incompatible theme as delete-only, with its reason and no activate/duplicate/export", () => {
    const t = {
      ...summary("local.old", "Old Skin"),
      incompatible: true,
      incompatibleReason: "Built for theme API 1.0, which v2 no longer runs.",
    };
    const page = cards(renderGrid([t]));
    expect(page.find((c) => c.name === "Old Skin")).toMatchObject({
      incompatible: "true",
      reason: "Built for theme API 1.0, which v2 no longer runs.",
      hasActivate: "no",
      hasDuplicate: "no",
      hasExport: "no",
      hasDelete: "yes",
    });
  });
});
