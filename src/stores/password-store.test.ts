import { describe, expect, it } from "vitest";
import { usePasswordStore } from "./password-store";

const request = { addr: "1.2.3.4:27016", serverName: "Test Server", keyring: true };

describe("usePasswordStore", () => {
  it("resolves the typed password and whether to remember it", async () => {
    const pending = usePasswordStore.getState().ask(request);
    usePasswordStore.getState().setDraft("pw");
    usePasswordStore.getState().submit();
    await expect(pending).resolves.toEqual({ password: "pw", remember: true });
  });

  it("never asks to remember without a keyring", async () => {
    const pending = usePasswordStore.getState().ask({ ...request, keyring: false });
    usePasswordStore.getState().setRemember(true);
    usePasswordStore.getState().setDraft("pw");
    usePasswordStore.getState().submit();
    await expect(pending).resolves.toEqual({ password: "pw", remember: false });
  });

  it("leaves the request open while the password is empty", async () => {
    let result: unknown = "pending";
    void usePasswordStore.getState().ask(request).then((r) => {
      result = r;
    });
    usePasswordStore.getState().submit();
    await Promise.resolve();
    expect(result).toBe("pending");
    usePasswordStore.getState().cancel();
  });

  it("cancels with null and clears the draft", async () => {
    const pending = usePasswordStore.getState().ask(request);
    usePasswordStore.getState().setDraft("half");
    usePasswordStore.getState().cancel();
    await expect(pending).resolves.toBeNull();
    expect(usePasswordStore.getState().draft).toBe("");
    expect(usePasswordStore.getState().request).toBeNull();
  });

  it("resolves a request still open when another one arrives with null", async () => {
    const first = usePasswordStore.getState().ask(request);
    const second = usePasswordStore.getState().ask({ ...request, addr: "5.6.7.8:27016" });
    await expect(first).resolves.toBeNull();
    usePasswordStore.getState().cancel();
    await expect(second).resolves.toBeNull();
  });
});
