import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SteamInitError } from "@/lib/tauri";
import { SteamRequiredModal } from "./steam-required-modal";

function initError(kind: SteamInitError["kind"]): SteamInitError {
  return { kind, message: "", autoRetry: true, autoRetryLimit: 5 };
}

describe("SteamRequiredModal", () => {
  it("shows an overlapping connect attempt as still connecting", () => {
    const html = renderToStaticMarkup(
      <SteamRequiredModal
        error={initError("already_initialising")}
        checking={false}
        exhausted={false}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Still connecting");
    expect(html).toContain("Checking automatically");
    expect(html).not.toContain("Couldn&#x27;t reach Steam");
  });
});
