import { useEffect, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { Copy, KeyRound } from "lucide-react";
import { joinLink } from "@/lib/join-link";
import { forgetPassword, passwordStatus, type PasswordStatus } from "@/lib/tauri";
import { useLaunchStore } from "@/stores/launch-store";
import { useMenuItemRole, useServerSubject } from "./server-elements";
import { usePopupContext } from "./popup-elements";
import { displayOption, parseDisplay } from "./element-utils";
import { OptionIcon } from "./option-icon";

type SavedPassword = PasswordStatus | "rejected";

const statuses = new Map<string, SavedPassword>();
const requests = new Map<string, Promise<SavedPassword>>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function isSaved(status: SavedPassword | undefined): boolean {
  return typeof status === "object" && status.saved;
}

/** Whether this server's password is saved, read once per address and shared by every caller. */
export function loadPasswordStatus(addr: string): Promise<SavedPassword> {
  const started = requests.get(addr);
  if (started) return started;

  const request = passwordStatus(addr)
    .catch((): SavedPassword => "rejected")
    .then((status) => {
      statuses.set(addr, status);
      requests.delete(addr);
      notify();
      return status;
    });
  requests.set(addr, request);
  return request;
}

/** Records that the address no longer has a saved password, so the menu item goes away. */
function forgetSavedPassword(addr: string): void {
  statuses.set(addr, { saved: false, keyring: true });
  notify();
}

function useSavedPassword(addr: string | undefined): SavedPassword | undefined {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
  return addr === undefined ? undefined : statuses.get(addr);
}

export function ServerCopyJoinLink({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const { popupId, close } = usePopupContext();
  const setNotice = useLaunchStore((s) => s.setNotice);
  const role = useMenuItemRole();
  if (!server) return null;

  const { showIcon, showLabel } = parseDisplay(options, "iconLabel");
  const label = (options?.label as string | undefined) ?? "Copy join link";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    close();
    void navigator.clipboard
      .writeText(joinLink(server))
      .then(() => {
        if (popupId) setNotice(server.addr, { kind: "plain", text: "Join link copied", tone: "success" });
      })
      .catch((err) => setNotice(server.addr, { kind: "plain", text: String(err) }));
  };

  return (
    <button
      type="button"
      role={role}
      data-el="server.copyJoinLink"
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex items-center gap-1.5 text-muted hover:text-ink"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={Copy} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ServerForgetPassword({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const addr = server?.addr;
  const saved = useSavedPassword(addr);
  const { close } = usePopupContext();
  const setNotice = useLaunchStore((s) => s.setNotice);
  const role = useMenuItemRole();

  useEffect(() => {
    if (addr !== undefined) void loadPasswordStatus(addr);
  }, [addr]);

  if (!server || !isSaved(saved)) return null;

  const { label, showIcon, showLabel } = displayOption(options, "Forget saved password", "iconLabel");

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    close();
    void forgetPassword(server.addr)
      .then(() => {
        forgetSavedPassword(server.addr);
        setNotice(server.addr, { kind: "plain", text: "Saved password removed.", tone: "success" });
      })
      .catch(() =>
        setNotice(server.addr, { kind: "plain", text: "Could not remove the saved password." }),
      );
  };

  return (
    <button
      type="button"
      role={role}
      data-el="server.forgetPassword"
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex items-center gap-1.5 text-muted hover:text-ink"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={KeyRound} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}
