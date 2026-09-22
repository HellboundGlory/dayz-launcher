import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Ban, Check, ExternalLink, Star } from "lucide-react";
import { cn, formatBytes, formatLastPlayed } from "@/lib/utils";
import { openWorkshopInSteam } from "@/lib/tauri";
import { useModFilterStore, type ModFilterEntry } from "@/stores/mod-filter-store";
import { useElementContext } from "./context";
import { OptionIcon } from "./option-icon";
import { hashHue, initials } from "./mod-thumbnail";
import type { ElementNode } from "../renderer/types";

function useWorkshopModSubject(): ModFilterEntry | null {
  const { subjectContext, previewMod } = useElementContext();
  if (subjectContext?.kind === "workshopMod") {
    return subjectContext.data as ModFilterEntry;
  }
  return previewMod as ModFilterEntry | null;
}

function formatEntryTime(unixSeconds: number, format: unknown): string {
  if (format === "date") {
    return new Date(unixSeconds * 1000).toLocaleDateString();
  }
  return formatLastPlayed(unixSeconds);
}

function WorkshopModPick({ className, style }: { className?: string; style?: CSSProperties }) {
  const entry = useWorkshopModSubject();
  const selection = useModFilterStore((s) => s.selection);
  const cycle = useModFilterStore((s) => s.cycle);
  if (!entry) return null;

  const current = selection[entry.id];
  const label =
    current === "include"
      ? `Exclude ${entry.title} instead`
      : current === "exclude"
        ? `Clear the ${entry.title} filter`
        : `Include ${entry.title}`;

  return (
    <button
      type="button"
      data-el="workshopMod.pick"
      data-state={current === "include" ? "included" : current === "exclude" ? "excluded" : undefined}
      aria-label={label}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        cycle(entry);
      }}
      className={className}
      style={style}
    >
      <span data-part="box">
        {current === "exclude" ? (
          <Ban className="size-full" strokeWidth={2.6} />
        ) : current === "include" ? (
          <Check className="size-full" strokeWidth={2.6} />
        ) : null}
      </span>
    </button>
  );
}

function WorkshopModThumbnail({ className, style }: { className?: string; style?: CSSProperties }) {
  const entry = useWorkshopModSubject();
  if (!entry) return null;

  const missing = !entry.previewUrl;
  return (
    <span data-el="workshopMod.thumbnail" data-state={missing ? "missing" : undefined} className={className} style={style}>
      {entry.previewUrl ? (
        <img data-part="image" src={entry.previewUrl} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      ) : (
        (() => {
          const hue = hashHue(entry.id);
          return (
            <span
              data-part="initials"
              className="flex h-full w-full items-center justify-center font-extrabold text-white/85"
              style={{ background: `linear-gradient(135deg, hsl(${hue} 42% 32%), hsl(${(hue + 42) % 360} 48% 20%))` }}
            >
              {initials(entry.title)}
            </span>
          );
        })()
      )}
    </span>
  );
}

function WorkshopModName({ className, style }: { className?: string; style?: CSSProperties }) {
  const entry = useWorkshopModSubject();
  if (!entry) return null;
  return (
    <span data-el="workshopMod.name" className={className ?? "truncate"} style={style}>
      <span data-part="text">{entry.title}</span>
    </span>
  );
}

function WorkshopModSubscribed({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  if (!entry || !entry.subscribed) return null;
  return (
    <span data-el="workshopMod.subscribed" className={className} style={style}>
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={Star} className="size-full fill-current" />
      </span>
    </span>
  );
}

function WorkshopModServerCount({ className, style }: { className?: string; style?: CSSProperties }) {
  const entry = useWorkshopModSubject();
  if (!entry) return null;

  const none = !entry.serverCount;
  return (
    <span data-el="workshopMod.serverCount" data-state={none ? "none" : undefined} className={className} style={style}>
      {none ? (
        <span data-part="value">—</span>
      ) : (
        <>
          <span data-part="value">{entry.serverCount}</span> <span data-part="unit">srv</span>
        </>
      )}
    </span>
  );
}

function WorkshopModScore({ className, style }: { className?: string; style?: CSSProperties }) {
  const entry = useWorkshopModSubject();
  if (!entry || entry.score === null) return null;
  return (
    <span data-el="workshopMod.score" className={className} style={style}>
      <span data-part="value">{Math.round(entry.score * 100)}%</span>
    </span>
  );
}

function WorkshopModSubscribers({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  if (!entry || !entry.numSubscriptions) return null;
  const label = (options?.label as string | undefined) ?? "subscribers";
  return (
    <span data-el="workshopMod.subscribers" className={className} style={style}>
      <span data-part="value">{Number(entry.numSubscriptions).toLocaleString()}</span>{" "}
      <span data-part="label">{label}</span>
    </span>
  );
}

function WorkshopModSize({ className, style }: { className?: string; style?: CSSProperties }) {
  const entry = useWorkshopModSubject();
  if (!entry) return null;

  const missing = entry.fileSize === null;
  return (
    <span data-el="workshopMod.size" data-state={missing ? "unknown" : undefined} className={className ?? "font-mono-data"} style={style}>
      <span data-part="value">{missing ? "—" : formatBytes(entry.fileSize as number, 1)}</span>
    </span>
  );
}

function WorkshopModUpdated({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  if (!entry || entry.timeUpdated === null) return null;

  const label = (options?.label as string | undefined) ?? "Updated";
  return (
    <span data-el="workshopMod.updated" className={className} style={style}>
      <span data-part="label">{label}</span>{" "}
      <span data-part="value">{formatEntryTime(entry.timeUpdated, options?.format ?? "relative")}</span>
    </span>
  );
}

function WorkshopModDescription({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  if (!entry) return null;

  const empty = !entry.description;
  const clampOpt = options?.clamp;
  const clamp = clampOpt === 3 || clampOpt === 6 ? clampOpt : undefined;
  const clampStyle: CSSProperties | undefined =
    clamp !== undefined ? ({ "--t-line-clamp": clamp } as CSSProperties) : undefined;

  return (
    <p
      data-el="workshopMod.description"
      data-state={empty ? "empty" : undefined}
      className={
        className ??
        cn(
          "text-muted",
          clamp !== undefined &&
            "[display:-webkit-box] [-webkit-box-orient:vertical] overflow-hidden [-webkit-line-clamp:var(--t-line-clamp)]",
        )
      }
      style={{ ...clampStyle, ...style }}
    >
      <span data-part="text">{empty ? "" : entry.description}</span>
    </p>
  );
}

function WorkshopModTags({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  if (!entry || entry.tags.length === 0) return null;

  const limitOpt = options?.limit;
  const limit = limitOpt === 3 || limitOpt === 6 ? limitOpt : undefined;
  const tags = limit !== undefined ? entry.tags.slice(0, limit) : entry.tags;

  return (
    <span data-el="workshopMod.tags" className={className} style={style}>
      {tags.map((t) => (
        <span key={t} data-part="chip">
          {t}
        </span>
      ))}
    </span>
  );
}

function WorkshopModServerNote({ className, style }: { className?: string; style?: CSSProperties }) {
  const entry = useWorkshopModSubject();
  if (!entry) return null;

  const text = entry.serverCount
    ? `${entry.serverCount} of the servers currently listed run this mod`
    : "Not seen on any currently listed server yet — you can still filter for it";

  return (
    <span data-el="workshopMod.serverNote" className={className} style={style}>
      <span data-part="text">{text}</span>
    </span>
  );
}

function WorkshopModViewOnSteam({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  if (!entry) return null;

  const label = (options?.label as string | undefined) ?? "View on Steam";

  return (
    <button
      type="button"
      data-el="workshopMod.viewOnSteam"
      aria-label={label}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        void openWorkshopInSteam(entry.id).catch((err) => console.error(err));
      }}
      className={className}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={ExternalLink} className="size-3" />
      </span>
      <span data-part="label">{label}</span>
    </button>
  );
}

function WorkshopModInclude({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  const selection = useModFilterStore((s) => s.selection);
  const setPick = useModFilterStore((s) => s.setPick);
  if (!entry) return null;

  const on = selection[entry.id] === "include";
  const label = (options?.label as string | undefined) ?? (on ? "Included" : "Include");

  return (
    <button
      type="button"
      data-el="workshopMod.include"
      data-state={on ? "on" : undefined}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        setPick(entry, "include");
      }}
      className={className}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

function WorkshopModExclude({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const entry = useWorkshopModSubject();
  const selection = useModFilterStore((s) => s.selection);
  const setPick = useModFilterStore((s) => s.setPick);
  if (!entry) return null;

  const on = selection[entry.id] === "exclude";
  const label = (options?.label as string | undefined) ?? (on ? "Excluded" : "Exclude");

  return (
    <button
      type="button"
      data-el="workshopMod.exclude"
      data-state={on ? "on" : undefined}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        setPick(entry, "exclude");
      }}
      className={className}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

/** Every `workshopMod.*` element; `undefined` for anything else. */
export function renderWorkshopModElement(
  node: ElementNode,
  { className, style }: { className?: string; style?: CSSProperties },
): ReactNode | undefined {
  switch (node.element) {
    case "workshopMod.pick":
      return <WorkshopModPick className={className} style={style} />;
    case "workshopMod.thumbnail":
      return <WorkshopModThumbnail className={className} style={style} />;
    case "workshopMod.name":
      return <WorkshopModName className={className} style={style} />;
    case "workshopMod.subscribed":
      return <WorkshopModSubscribed options={node.options} className={className} style={style} />;
    case "workshopMod.serverCount":
      return <WorkshopModServerCount className={className} style={style} />;
    case "workshopMod.score":
      return <WorkshopModScore className={className} style={style} />;
    case "workshopMod.subscribers":
      return <WorkshopModSubscribers options={node.options} className={className} style={style} />;
    case "workshopMod.size":
      return <WorkshopModSize className={className} style={style} />;
    case "workshopMod.updated":
      return <WorkshopModUpdated options={node.options} className={className} style={style} />;
    case "workshopMod.description":
      return <WorkshopModDescription options={node.options} className={className} style={style} />;
    case "workshopMod.tags":
      return <WorkshopModTags options={node.options} className={className} style={style} />;
    case "workshopMod.serverNote":
      return <WorkshopModServerNote className={className} style={style} />;
    case "workshopMod.viewOnSteam":
      return <WorkshopModViewOnSteam options={node.options} className={className} style={style} />;
    case "workshopMod.include":
      return <WorkshopModInclude options={node.options} className={className} style={style} />;
    case "workshopMod.exclude":
      return <WorkshopModExclude options={node.options} className={className} style={style} />;
    default:
      return undefined;
  }
}
