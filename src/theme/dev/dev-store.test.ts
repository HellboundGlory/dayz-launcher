import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Palette } from "@/theme/palette";
import type { ValidationIssue } from "@/types/theme";
import { clearDevState, noteDevReload, refreshDevIssues, useDevStore } from "./dev-store";

const backend = vi.hoisted(() => ({
  validateTheme: vi.fn<(id: string) => Promise<ValidationIssue[]>>(),
}));

vi.mock("@/lib/tauri", () => ({
  validateTheme: backend.validateTheme,
}));

const PALETTE: Palette = {
  bg: "#ffffff",
  surface: "#ffffff",
  surface2: "#ffffff",
  border: "#ffffff",
  text: "#000000",
  muted: "#595959",
  muted2: "#595959",
  accent: "#003366",
  accent2: "#003366",
  success: "#004d00",
  warn: "#665500",
  danger: "#660000",
};

const ROLE_COLORS: Record<string, string> = {
  onAccent: "#ffffff",
  onAccent2: "#ffffff",
  onDanger: "#ffffff",
};

const BACKEND_ISSUE: ValidationIssue = {
  ruleId: "LAY-01",
  severity: "error",
  file: "layout/shell.json",
  pointer: "/slots/main",
  message: "missing child",
};

beforeEach(() => {
  backend.validateTheme.mockReset();
  useDevStore.getState().clear();
  useDevStore.setState({ activeRenderers: 0 });
});

describe("useDevStore", () => {
  it("populates issues and contrast on a successful refresh, leaving error null", async () => {
    backend.validateTheme.mockResolvedValue([BACKEND_ISSUE]);
    await refreshDevIssues("my-theme", PALETTE, ROLE_COLORS, "dark");
    const state = useDevStore.getState();
    expect(state.issues).toEqual([BACKEND_ISSUE]);
    expect(state.contrast).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.refreshing).toBe(false);
  });

  it("stores the rejection message, empties issues, and still populates contrast", async () => {
    backend.validateTheme.mockRejectedValue(new Error("theme folder missing"));
    const badPalette: Palette = { ...PALETTE, text: "#464646", bg: "#0d0f13" };
    await refreshDevIssues("my-theme", badPalette, ROLE_COLORS, "dark");
    const state = useDevStore.getState();
    expect(state.issues).toEqual([]);
    expect(state.error).toContain("theme folder missing");
    expect(state.contrast.length).toBeGreaterThan(0);
    expect(state.refreshing).toBe(false);
  });

  it("sets refreshing true while in flight and false once settled, on success and on failure", async () => {
    let resolveIt: (issues: ValidationIssue[]) => void;
    backend.validateTheme.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveIt = resolve;
      }),
    );
    const pending = refreshDevIssues("my-theme", PALETTE, ROLE_COLORS, "dark");
    expect(useDevStore.getState().refreshing).toBe(true);
    resolveIt!([]);
    await pending;
    expect(useDevStore.getState().refreshing).toBe(false);

    backend.validateTheme.mockRejectedValueOnce(new Error("boom"));
    await refreshDevIssues("my-theme", PALETTE, ROLE_COLORS, "dark");
    expect(useDevStore.getState().refreshing).toBe(false);
  });

  it("keeps the newer refresh's results when a slower earlier one resolves later", async () => {
    let resolveFirst: (issues: ValidationIssue[]) => void;
    backend.validateTheme.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const first = refreshDevIssues("theme-a", PALETTE, ROLE_COLORS, "dark");

    backend.validateTheme.mockResolvedValueOnce([BACKEND_ISSUE]);
    const second = refreshDevIssues("theme-b", PALETTE, ROLE_COLORS, "dark");
    await second;
    expect(useDevStore.getState().issues).toEqual([BACKEND_ISSUE]);

    resolveFirst!([]);
    await first;
    expect(useDevStore.getState().issues).toEqual([BACKEND_ISSUE]);
  });

  it("clear resets every field including variantWidth, settingsOverride and heldReload", () => {
    useDevStore.setState({
      issues: [BACKEND_ISSUE],
      contrast: [BACKEND_ISSUE],
      error: "oops",
      variantWidth: 650,
      settingsOverride: { showFps: true },
      heldReload: true,
    });
    clearDevState();
    const state = useDevStore.getState();
    expect(state.issues).toEqual([]);
    expect(state.contrast).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.variantWidth).toBeNull();
    expect(state.settingsOverride).toBeNull();
    expect(state.heldReload).toBe(false);
    expect(state.refreshing).toBe(false);
  });

  it("noteReload sets issues, heldReload and error, leaving contrast and the two overrides alone", () => {
    useDevStore.setState({
      contrast: [BACKEND_ISSUE],
      variantWidth: 975,
      settingsOverride: { compact: true },
    });
    noteDevReload([BACKEND_ISSUE], true, "boom");
    const state = useDevStore.getState();
    expect(state.issues).toEqual([BACKEND_ISSUE]);
    expect(state.heldReload).toBe(true);
    expect(state.error).toBe("boom");
    expect(state.contrast).toEqual([BACKEND_ISSUE]);
    expect(state.variantWidth).toBe(975);
    expect(state.settingsOverride).toEqual({ compact: true });
  });

  it("a successful refresh clears a held reload", async () => {
    useDevStore.setState({ heldReload: true });
    backend.validateTheme.mockResolvedValue([]);
    await refreshDevIssues("my-theme", PALETTE, ROLE_COLORS, "dark");
    expect(useDevStore.getState().heldReload).toBe(false);
  });

  it("setVariantWidth and setSettingsOverride round-trip, including back to null", () => {
    useDevStore.getState().setVariantWidth(975);
    expect(useDevStore.getState().variantWidth).toBe(975);
    useDevStore.getState().setVariantWidth(null);
    expect(useDevStore.getState().variantWidth).toBeNull();

    useDevStore.getState().setSettingsOverride({ rowDensity: "compact" });
    expect(useDevStore.getState().settingsOverride).toEqual({ rowDensity: "compact" });
    useDevStore.getState().setSettingsOverride(null);
    expect(useDevStore.getState().settingsOverride).toBeNull();
  });

  it("registerRenderer increments activeRenderers and its returned function decrements it", () => {
    expect(useDevStore.getState().activeRenderers).toBe(0);
    const unregister = useDevStore.getState().registerRenderer();
    expect(useDevStore.getState().activeRenderers).toBe(1);
    unregister();
    expect(useDevStore.getState().activeRenderers).toBe(0);
  });

  it("counts overlapping registrations correctly", () => {
    const unregisterA = useDevStore.getState().registerRenderer();
    const unregisterB = useDevStore.getState().registerRenderer();
    expect(useDevStore.getState().activeRenderers).toBe(2);
    unregisterA();
    expect(useDevStore.getState().activeRenderers).toBe(1);
    unregisterB();
    expect(useDevStore.getState().activeRenderers).toBe(0);
  });

  it("never lets activeRenderers go below 0", () => {
    const unregister = useDevStore.getState().registerRenderer();
    unregister();
    unregister();
    expect(useDevStore.getState().activeRenderers).toBe(0);
  });

  it("clear leaves activeRenderers untouched while resetting the other fields", () => {
    useDevStore.getState().registerRenderer();
    useDevStore.setState({ issues: [BACKEND_ISSUE], variantWidth: 650 });
    clearDevState();
    const state = useDevStore.getState();
    expect(state.activeRenderers).toBe(1);
    expect(state.issues).toEqual([]);
    expect(state.variantWidth).toBeNull();
  });
});
