import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Server } from "@/types/server";
import type { PasswordStatus } from "@/lib/tauri";
import { joinLink } from "@/lib/join-link";
import { ElementContextProvider } from "./context";
import { PopupContextProvider } from "./popup-elements";
import { loadPasswordStatus, ServerCopyJoinLink, ServerForgetPassword } from "./row-menu-elements";

const { passwordStatus, forgetPassword } = vi.hoisted(() => ({
  passwordStatus: vi.fn<(addr: string) => Promise<PasswordStatus>>(),
  forgetPassword: vi.fn<(addr: string) => Promise<void>>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, passwordStatus, forgetPassword };
});

const { setNotice } = vi.hoisted(() => ({ setNotice: vi.fn() }));
vi.mock("@/stores/launch-store", () => ({
  useLaunchStore: <R,>(select: (state: { setNotice: typeof setNotice }) => R) => select({ setNotice }),
}));

const close = vi.fn();
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const key = (props?.["data-el"] as string | undefined) ?? (props?.["data-part"] as string | undefined);
      if (typeof key === "string") captured[key] = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

// One address per case: a saved-password lookup is kept for the address it ran against.
let nextAddr = 1;
function serverFor(addr: string): Server {
  return {
    addr,
    query_port: 27016,
    game_port: 2302,
    name: "Test Server",
    map_display: "Chernarus",
    players: 10,
    max_players: 60,
    ping: 30,
    locked: true,
    online: true,
  } as Server;
}

function render(node: ReactNode, server: Server): string {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ subjectContext: { kind: "server", data: server }, contextName: "popup" }}>
      <PopupContextProvider popupId="serverRow" close={close}>
        {node}
      </PopupContextProvider>
    </ElementContextProvider>,
  );
}

function clickForget(): void {
  (captured["server.forgetPassword"]?.onClick as (e: { stopPropagation: () => void }) => void)({
    stopPropagation: () => {},
  });
}

function freshServer(): Server {
  const server = serverFor(`10.0.0.${nextAddr++}:27016`);
  close.mockReset();
  setNotice.mockReset();
  forgetPassword.mockReset().mockResolvedValue(undefined);
  for (const key of Object.keys(captured)) delete captured[key];
  return server;
}

describe("ServerForgetPassword", () => {
  it("renders nothing while the saved password is still being looked up", () => {
    const server = freshServer();
    passwordStatus.mockReturnValue(new Promise(() => {}));

    void loadPasswordStatus(server.addr);

    expect(render(<ServerForgetPassword />, server)).toBe("");
  });

  it.each<{ label: string; status: () => Promise<PasswordStatus> }>([
    { label: "nothing is saved", status: async () => ({ saved: false, keyring: true }) },
    { label: "the status call rejects", status: async () => Promise.reject(new Error("no store")) },
  ])("renders nothing when $label", async ({ status }) => {
    const server = freshServer();
    passwordStatus.mockImplementation(status);

    await loadPasswordStatus(server.addr);

    expect(render(<ServerForgetPassword />, server)).toBe("");
  });

  it("offers to forget the password once one is saved", async () => {
    const server = freshServer();
    passwordStatus.mockResolvedValue({ saved: true, keyring: true });

    await loadPasswordStatus(server.addr);

    const html = render(<ServerForgetPassword />, server);
    expect(html).toContain('data-el="server.forgetPassword"');
    expect(html).toContain("Forget saved password");
    expect(html).toContain('role="menuitem"');
    expect(passwordStatus).toHaveBeenCalledWith(server.addr);
  });

  it("forgets the saved password, closes the menu and says so", async () => {
    const server = freshServer();
    passwordStatus.mockResolvedValue({ saved: true, keyring: true });
    await loadPasswordStatus(server.addr);
    render(<ServerForgetPassword />, server);

    clickForget();

    await vi.waitFor(() =>
      expect(setNotice).toHaveBeenCalledWith(server.addr, {
        kind: "plain",
        text: "Saved password removed.",
        tone: "success",
      }),
    );
    expect(forgetPassword).toHaveBeenCalledWith(server.addr);
    expect(close).toHaveBeenCalled();
  });

  it("says the password could not be removed when forgetting fails", async () => {
    const server = freshServer();
    passwordStatus.mockResolvedValue({ saved: true, keyring: true });
    forgetPassword.mockRejectedValue(new Error("keyring locked"));
    await loadPasswordStatus(server.addr);
    render(<ServerForgetPassword />, server);

    clickForget();

    await vi.waitFor(() =>
      expect(setNotice).toHaveBeenCalledWith(server.addr, {
        kind: "plain",
        text: "Could not remove the saved password.",
      }),
    );
  });

  it("stops offering to forget once the password is gone", async () => {
    const server = freshServer();
    passwordStatus.mockResolvedValue({ saved: true, keyring: true });
    await loadPasswordStatus(server.addr);
    render(<ServerForgetPassword />, server);

    clickForget();
    await vi.waitFor(() => expect(forgetPassword).toHaveBeenCalled());

    expect(render(<ServerForgetPassword />, server)).toBe("");
  });
});

describe("ServerCopyJoinLink", () => {
  it("copies the server's join link and says so", async () => {
    const server = freshServer();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const html = render(<ServerCopyJoinLink />, server);
    expect(html).toContain('data-el="server.copyJoinLink"');
    expect(html).toContain("Copy join link");

    (captured["server.copyJoinLink"]?.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: () => {},
    });

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(joinLink(server)));
    await vi.waitFor(() =>
      expect(setNotice).toHaveBeenCalledWith(server.addr, {
        kind: "plain",
        text: "Join link copied",
        tone: "success",
      }),
    );
    expect(close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
