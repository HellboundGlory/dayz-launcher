import { useEffect, useId, useRef, type ReactNode } from "react";
import { CircleCheck, LoaderCircle, Plus, Star, X } from "lucide-react";
import { useAddServerStore, type AddServerState } from "@/stores/add-server-store";
import { useServerActions } from "@/hooks/use-server-actions";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { wrapTabWithin } from "@/theme/interaction/popup-keyboard";
import type { Server } from "@/types/server";

const SECONDARY =
  "flex items-center gap-1.5 [border-radius:var(--t-radius-controlSmall)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-size-md)] font-semibold text-ink hover:bg-line disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY =
  "flex items-center gap-1.5 [border-radius:var(--t-radius-controlSmall)] bg-accent px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-size-md)] font-semibold text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100";

interface AddServerBoxProps {
  input: string;
  state: AddServerState;
  server: Server | null;
  /** The command's message, for `error`. */
  message: string | null;
  /** Whether the found server is already saved. */
  favourite: boolean;
  /** True while adding to favourites. */
  busy: boolean;
  onInput: (text: string) => void;
  onClear: () => void;
  onLookup: () => void;
  onCancel: () => void;
  onFavourite: () => void;
  onJoin: () => void;
}

/** The Add server dialog's markup; all state comes in through props so it renders alone. */
export function AddServerBox({
  input,
  state,
  server,
  message,
  favourite,
  busy,
  onInput,
  onClear,
  onLookup,
  onCancel,
  onFavourite,
  onJoin,
}: AddServerBoxProps) {
  const titleId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const found = state === "found" && server !== null;

  let result: ReactNode = null;
  if (state === "searching") {
    result = (
      <p data-part="searching" className="m-0 flex items-center gap-2 [font-size:var(--t-type-body-size)] text-muted2">
        <LoaderCircle aria-hidden className="size-4 shrink-0 motion-safe:animate-spin text-accent" />
        Looking…
      </p>
    );
  } else if (state === "notFound") {
    result = (
      <p data-part="notFound" className="m-0 [font-size:var(--t-type-body-size)] text-danger">
        Nothing answered at {input}. Check the address and the port.
      </p>
    );
  } else if (state === "error") {
    result = (
      <p data-part="error" className="m-0 [font-size:var(--t-type-body-size)] text-danger">
        {message}
      </p>
    );
  } else if (found && server) {
    result = (
      <div
        data-part="result"
        className="grid min-w-0 gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 p-3 [font-size:var(--t-type-body-size)] text-ink"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
          <b data-part="name" className="min-w-0 truncate font-semibold">
            {server.name}
          </b>
        </div>
        <dl data-part="facts" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 [font-size:var(--t-type-data-size)]">
          <dt className="text-muted">Map</dt>
          <dd className="m-0 text-ink">{server.map_display}</dd>
          <dt className="text-muted">Players</dt>
          <dd className="m-0 font-mono tabular-nums text-ink">
            {server.players}/{server.max_players}
          </dd>
          <dt className="text-muted">Ping</dt>
          <dd className="m-0 font-mono tabular-nums text-ink">
            {server.ping === null ? "—" : `${server.ping} ms`}
          </dd>
          <dt className="text-muted">Found at</dt>
          <dd className="m-0 truncate font-mono text-ink">{server.addr}</dd>
        </dl>
      </div>
    );
  }
  const status = (
    <div data-part="status" aria-live="polite" className="grid gap-2">
      {result}
      {found && message && (
        <p data-part="error" className="m-0 [font-size:var(--t-type-body-size)] text-danger">
          {message}
        </p>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 [background-color:var(--t-color-scrim)]"
      onClick={onCancel}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add server"
        aria-labelledby={titleId}
        onKeyDown={(e) => wrapTabWithin(wrapRef.current, e)}
        onClick={(e) => e.stopPropagation()}
        className="flex w-[min(460px,100%)] flex-col [border-radius:var(--t-radius-confirm)] border border-line bg-surface [box-shadow:var(--t-shadow-confirm)]"
      >
        <div className="flex items-start gap-3 px-4 pt-4">
          <h2 id={titleId} data-part="title" className="m-0 flex-1 [font-size:var(--t-type-heading-size)] font-semibold leading-5 text-ink">
            Add server
          </h2>
          <button
            type="button"
            data-part="close"
            aria-label="Close"
            onClick={onCancel}
            className="grid size-6 shrink-0 place-items-center text-muted hover:text-ink"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>

        <div className="grid gap-3 px-4 py-3.5">
          <label className="grid gap-1.5">
            <span className="[font-size:var(--t-type-caption-size)] font-semibold uppercase tracking-wider text-muted2">
              Address
            </span>
            <span className="flex items-center gap-2 [border-radius:var(--t-radius-control)] border border-line bg-bg px-2.5 focus-within:border-accent">
              <Plus aria-hidden className="size-3.5 shrink-0 text-muted" />
              <input
                data-part="address"
                type="text"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                maxLength={255}
                value={input}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onLookup();
                  }
                }}
                className="min-w-0 flex-1 bg-transparent py-1.5 [font-size:var(--t-type-body-size)] text-ink outline-none"
              />
              {input.length > 0 && (
                <button
                  type="button"
                  data-part="clear"
                  aria-label="Clear address"
                  onClick={onClear}
                  className="grid size-5 shrink-0 place-items-center text-muted hover:text-ink"
                >
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </span>
          </label>
          <p data-part="hint" className="m-0 [font-size:var(--t-type-caption-size)] leading-relaxed text-muted">
            An IP or a host name. The port is optional: Tetra tries the one you type, the next three, and the usual
            DayZ ports.
          </p>
          {status}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" data-part="cancel" onClick={onCancel} className={SECONDARY}>
            Cancel
          </button>
          <button
            type="button"
            data-part="favourite"
            disabled={!found || favourite || busy}
            onClick={onFavourite}
            className={SECONDARY}
          >
            <Star aria-hidden className="size-3.5" />
            {favourite ? "In favourites" : "Add to favourites"}
          </button>
          <button type="button" data-part="join" disabled={!found || busy} onClick={onJoin} className={PRIMARY}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Add server box, open while the + button has asked for it. */
export function AddServerDialog() {
  const open = useAddServerStore((s) => s.open);
  if (!open) return null;
  return <OpenAddServer />;
}

function OpenAddServer() {
  const input = useAddServerStore((s) => s.input);
  const state = useAddServerStore((s) => s.state);
  const server = useAddServerStore((s) => s.server);
  const message = useAddServerStore((s) => s.message);
  const busy = useAddServerStore((s) => s.busy);
  const type = useAddServerStore((s) => s.type);
  const submit = useAddServerStore((s) => s.submit);
  const favourite = useAddServerStore((s) => s.favourite);
  const close = useAddServerStore((s) => s.close);
  const { verifyAndJoin } = useServerActions();

  useEscapeLayer(true, close);

  // The button that opened it is where the keyboard was before, so put it back there.
  // The input takes focus here rather than through autoFocus alone: a remount
  // (React's development double run) would leave it on the opener.
  useEffect(() => {
    const opener = document.querySelector<HTMLElement>('[data-el="servers.addServer"]');
    document.querySelector<HTMLInputElement>('[role="dialog"] input[data-part="address"]')?.focus();
    return () => opener?.focus();
  }, []);

  const onJoin = () => {
    if (!server) return;
    const target = server;
    close();
    void verifyAndJoin(target);
  };

  return (
    <AddServerBox
      input={input}
      state={state}
      server={server}
      message={message}
      favourite={server?.favourite ?? false}
      busy={busy}
      onInput={type}
      onClear={() => type("")}
      onLookup={submit}
      onCancel={close}
      onFavourite={() => void favourite()}
      onJoin={onJoin}
    />
  );
}
