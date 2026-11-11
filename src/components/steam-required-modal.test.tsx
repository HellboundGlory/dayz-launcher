import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SteamInitError } from "@/lib/tauri";
import { SteamRequiredModal } from "./steam-required-modal";

describe("SteamRequiredModal", () => {
  it("asks for a restart instead of offering a retry once Steam disconnects", () => {
    const error: SteamInitError = {
      kind: "disconnected",
      message: "",
      autoRetry: false,
      autoRetryLimit: 0,
    };
    const html = renderToStaticMarkup(
      <SteamRequiredModal
        error={error}
        checking={false}
        exhausted={false}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Steam disconnected");
    expect(html).toContain("Close the launcher and open it again");
    expect(html).not.toContain("retryAction");
  });
});
