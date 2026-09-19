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
    onExport,
    onRequestDelete,
  }: {
    name: string;
    builtin: boolean;
    onExport?: () => void;
    onRequestDelete?: () => void;
  }) => (
    <p
      data-name={name}
      data-builtin={String(builtin)}
      data-has-export={onExport !== undefined ? "yes" : "no"}
      data-has-delete={onRequestDelete !== undefined ? "yes" : "no"}
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
  [...html.matchAll(/data-name="([^"]+)" data-builtin="(\w+)" data-has-export="(\w+)" data-has-delete="(\w+)"/g)].map(
    ([, name, builtin, hasExport, hasDelete]) => ({ name, builtin, hasExport, hasDelete }),
  );

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
    expect(page).toEqual([
      { name: "Neutral", builtin: "true", hasExport: "no", hasDelete: "no" },
      { name: "My Skin", builtin: "false", hasExport: "yes", hasDelete: "yes" },
    ]);
  });
});
