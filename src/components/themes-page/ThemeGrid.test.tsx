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
