/** ThemeCard is stubbed to serialize its props: the node test env has no DOM
 * and the real card's menu is closed in static markup. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGridEntries, ThemeGrid } from "./theme-grid";
import type { ThemeSummary } from "@/types/theme";

vi.mock("./theme-card", () => ({
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
  it("orders neutral, then the showcase theme, then user themes, the showcase marked builtin", () => {
    const entries = buildGridEntries(scanOrder);
    expect(entries.map((e) => e.id)).toEqual(["neutral", "builtin.tactical", "local.myskin"]);
    expect(entries[1]).toMatchObject({ id: "builtin.tactical", builtin: true });
    expect(entries[2]).toMatchObject({ id: "local.myskin", builtin: false });
  });

  it("drops the showcase id when the backend has not seeded it, without error", () => {
    const entries = buildGridEntries([summary("local.x", "X")]);
    expect(entries.map((e) => e.id)).toEqual(["neutral", "local.x"]);
  });

  const previewCases: { case: string; extra: Partial<ThemeSummary>; want: string | undefined }[] = [
    {
      case: "the first previews entry over the legacy field",
      extra: { preview: "preview.png", previews: [{ file: "previews/one.png", caption: "One" }] },
      want: "previews/one.png",
    },
    { case: "the legacy field when previews is absent", extra: { preview: "preview.png" }, want: "preview.png" },
    { case: "the legacy field when previews is empty", extra: { preview: "preview.png", previews: [] }, want: "preview.png" },
    { case: "no preview when neither field is set", extra: {}, want: undefined },
  ];

  it.each(previewCases)("takes $case", ({ extra, want }) => {
    const entries = buildGridEntries([{ ...summary("local.x", "X"), ...extra }]);
    expect(entries.find((e) => e.id === "local.x")).toMatchObject({ preview: want });
  });

  it("carries an incompatible theme's flag and reason through, leaving an ordinary theme's undefined", () => {
    const old = { ...summary("local.old", "Old Skin"), incompatible: true, incompatibleReason: "v1 theme" };
    const entries = buildGridEntries([old, summary("local.x", "X")]);

    expect(entries.find((e) => e.id === "local.old")).toMatchObject({
      incompatible: true,
      incompatibleReason: "v1 theme",
    });
    expect(entries.find((e) => e.id === "local.x")).toMatchObject({
      incompatible: undefined,
      incompatibleReason: undefined,
    });
  });
});

describe("ThemeGrid render", () => {
  it("offers export and delete only on an ordinary installed theme's card", () => {
    const page = cards(renderGrid(scanOrder));
    expect(page.map((c) => c.name)).toEqual(["Neutral", "Tactical", "My Skin"]);
    expect(page.map((c) => [c.builtin, c.hasExport, c.hasDelete])).toEqual([
      ["true", "no", "no"],
      ["true", "no", "no"],
      ["false", "yes", "yes"],
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
