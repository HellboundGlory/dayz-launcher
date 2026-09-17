import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { useServerStore } from "@/stores/server-store";
import { SLOTS } from "@/theme/slots";
import { buildFilterBarControls, FilterBar } from "./filter-bar";

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

function getControls() {
  const state = useServerStore.getState();
  return buildFilterBarControls({
    filter: state.filter,
    setFilter: state.setFilter,
    resetFilter: state.resetFilter,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    setSort: state.setSort,
    onRefresh: () => {},
    refreshing: false,
    onOpenModFilter: () => {},
    modFilterOpen: false,
  });
}

describe("FilterBar controls node map", () => {
  it("covers every registered child ID of filterBar from SLOTS in slots.ts", () => {
    const slot = SLOTS.find((s) => s.id === "filterBar");
    expect(slot).toBeDefined();

    const controls = getControls();
    const registeredIds = slot!.children.map((c) => c.id);

    for (const child of slot!.children) {
      expect(controls[child.id], `Missing control for child: ${child.id}`).toBeDefined();
    }
    expect(Object.keys(controls).sort()).toEqual(registeredIds.sort());
  });
});

describe("FilterBar hide toggles", () => {
  beforeEach(() => {
    useServerStore.getState().resetFilter();
  });

  it("toggling hideEmptyToggle updates the store filter", () => {
    expect(useServerStore.getState().filter.hide_empty).toBe(false);

    let controls = getControls();
    const button = controls.hideEmptyToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      title: string;
      children: React.ReactNode;
      className: string;
    }>;

    expect(button.props["aria-pressed"]).toBe(false);
    expect(button.props.title).toBe("Hide empty servers (0 players)");
    expect(button.props.children).toBe("Hide empty");
    expect(button.props.className).toContain("border-line bg-surface2 text-muted");

    button.props.onClick();
    expect(useServerStore.getState().filter.hide_empty).toBe(true);

    controls = getControls();
    const activeBtn = controls.hideEmptyToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      className: string;
    }>;
    expect(activeBtn.props["aria-pressed"]).toBe(true);
    expect(activeBtn.props.className).toContain("border-accent-line bg-accent-soft text-accent");

    activeBtn.props.onClick();
    expect(useServerStore.getState().filter.hide_empty).toBe(false);
  });

  it("toggling hideFullToggle updates the store filter", () => {
    expect(useServerStore.getState().filter.hide_full).toBe(false);

    let controls = getControls();
    const button = controls.hideFullToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      title: string;
      children: React.ReactNode;
      className: string;
    }>;

    expect(button.props["aria-pressed"]).toBe(false);
    expect(button.props.title).toBe("Hide full servers");
    expect(button.props.children).toBe("Hide full");
    expect(button.props.className).toContain("border-line bg-surface2 text-muted");

    button.props.onClick();
    expect(useServerStore.getState().filter.hide_full).toBe(true);

    controls = getControls();
    const activeBtn = controls.hideFullToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      className: string;
    }>;
    expect(activeBtn.props["aria-pressed"]).toBe(true);
    expect(activeBtn.props.className).toContain("border-accent-line bg-accent-soft text-accent");

    activeBtn.props.onClick();
    expect(useServerStore.getState().filter.hide_full).toBe(false);
  });

  it("toggling hideLockedToggle updates the store filter", () => {
    expect(useServerStore.getState().filter.hide_locked).toBe(false);

    let controls = getControls();
    const button = controls.hideLockedToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      title: string;
      children: React.ReactNode;
      className: string;
    }>;

    expect(button.props["aria-pressed"]).toBe(false);
    expect(button.props.title).toBe("Hide password-protected servers");
    expect(button.props.children).toBe("Hide locked");
    expect(button.props.className).toContain("border-line bg-surface2 text-muted");

    button.props.onClick();
    expect(useServerStore.getState().filter.hide_locked).toBe(true);

    controls = getControls();
    const activeBtn = controls.hideLockedToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      className: string;
    }>;
    expect(activeBtn.props["aria-pressed"]).toBe(true);
    expect(activeBtn.props.className).toContain("border-accent-line bg-accent-soft text-accent");

    activeBtn.props.onClick();
    expect(useServerStore.getState().filter.hide_locked).toBe(false);
  });

  it("toggling hideOfflineToggle updates the store filter", () => {
    expect(useServerStore.getState().filter.hide_offline).toBe(false);

    let controls = getControls();
    const button = controls.hideOfflineToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      title: string;
      children: React.ReactNode;
      className: string;
    }>;

    expect(button.props["aria-pressed"]).toBe(false);
    expect(button.props.title).toBe("Hide unreachable or offline servers");
    expect(button.props.children).toBe("Hide offline");
    expect(button.props.className).toContain("border-line bg-surface2 text-muted");

    button.props.onClick();
    expect(useServerStore.getState().filter.hide_offline).toBe(true);

    controls = getControls();
    const activeBtn = controls.hideOfflineToggle as ReactElement<{
      onClick: () => void;
      "aria-pressed": boolean;
      className: string;
    }>;
    expect(activeBtn.props["aria-pressed"]).toBe(true);
    expect(activeBtn.props.className).toContain("border-accent-line bg-accent-soft text-accent");

    activeBtn.props.onClick();
    expect(useServerStore.getState().filter.hide_offline).toBe(false);
  });

  it("resetFilter clears all four toggles back to false", () => {
    useServerStore.getState().setFilter({
      hide_empty: true,
      hide_full: true,
      hide_locked: true,
      hide_offline: true,
    });

    const before = useServerStore.getState().filter;
    expect(before.hide_empty).toBe(true);
    expect(before.hide_full).toBe(true);
    expect(before.hide_locked).toBe(true);
    expect(before.hide_offline).toBe(true);

    useServerStore.getState().resetFilter();

    const after = useServerStore.getState().filter;
    expect(after.hide_empty).toBe(false);
    expect(after.hide_full).toBe(false);
    expect(after.hide_locked).toBe(false);
    expect(after.hide_offline).toBe(false);
  });

  it("clicking resetAction clears all four toggles back to false", () => {
    useServerStore.getState().setFilter({
      hide_empty: true,
      hide_full: true,
      hide_locked: true,
      hide_offline: true,
    });

    const controls = getControls();
    const resetBtn = controls.resetAction as ReactElement<{ onClick: () => void }>;
    resetBtn.props.onClick();

    const after = useServerStore.getState().filter;
    expect(after.hide_empty).toBe(false);
    expect(after.hide_full).toBe(false);
    expect(after.hide_locked).toBe(false);
    expect(after.hide_offline).toBe(false);
  });
});

describe("FilterBar component markup", () => {
  it("renders controls in slot order without duplicating resetAction", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        onRefresh={() => {}}
        refreshing={false}
        onOpenModFilter={() => {}}
        modFilterOpen={false}
      />,
    );

    expect(html).toContain('data-tetra-el="hideEmptyToggle"');
    expect(html).toContain('data-tetra-el="hideFullToggle"');
    expect(html).toContain('data-tetra-el="hideLockedToggle"');
    expect(html).toContain('data-tetra-el="hideOfflineToggle"');
    expect(html).toContain('data-tetra-el="resetAction"');

    const resetMatches = html.match(/data-tetra-el="resetAction"/g);
    expect(resetMatches).toHaveLength(1);
  });
});
