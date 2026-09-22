import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useModFilterStore, pickSummary, type ModFilterTab } from "@/stores/mod-filter-store";
import { useElementContext } from "./context";
import { OptionIcon } from "./option-icon";
import { nextTabIndex } from "../interaction/tabs";
import type { ElementNode } from "../renderer/types";

const SOURCE_TABS: { key: ModFilterTab; label: string }[] = [
  { key: "subscribed", label: "Subscribed" },
  { key: "seen", label: "Seen on servers" },
  { key: "workshop", label: "Search Workshop" },
];

function searchPlaceholder(tab: ModFilterTab): string {
  if (tab === "workshop") return "Search the Workshop by name…";
  if (tab === "subscribed") return "Filter your subscribed mods…";
  return "Filter mods seen on these servers…";
}

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function SummaryThumb({ id, title, previewUrl }: { id: string; title: string; previewUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  if (previewUrl && !broken) {
    return (
      <img
        src={previewUrl}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    );
  }
  const hue = hashHue(id);
  return (
    <div
      className="flex h-full w-full items-center justify-center text-[8px] font-extrabold text-white/85"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 42% 32%), hsl(${(hue + 42) % 360} 48% 20%))` }}
    >
      {initials(title)}
    </div>
  );
}

function ModFilterApply({ className, style }: { className?: string; style?: CSSProperties }) {
  const apply = useModFilterStore((s) => s.apply);
  const { closeModal } = useElementContext();
  return (
    <button
      type="button"
      data-el="modFilter.apply"
      onClick={() => {
        apply();
        closeModal();
      }}
      className={className}
      style={style}
    >
      <span data-part="label">Apply</span>
    </button>
  );
}

function ModFilterCancel({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { closeModal } = useElementContext();
  const label = (options?.label as string | undefined) ?? "Cancel";
  return (
    <button type="button" data-el="modFilter.cancel" onClick={closeModal} className={className} style={style}>
      <span data-part="label">{label}</span>
    </button>
  );
}

function ModFilterClear({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const selection = useModFilterStore((s) => s.selection);
  const clearSelection = useModFilterStore((s) => s.clearSelection);
  const label = (options?.label as string | undefined) ?? "Clear";
  const disabled = Object.keys(selection).length === 0;
  return (
    <button
      type="button"
      data-el="modFilter.clear"
      data-state={disabled ? "disabled" : undefined}
      disabled={disabled}
      onClick={() => clearSelection()}
      className={className}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

function ModFilterSource({ className, style }: { className?: string; style?: CSSProperties }) {
  const tab = useModFilterStore((s) => s.tab);
  const setTab = useModFilterStore((s) => s.setTab);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const nextIndex = nextTabIndex({
      key: e.key,
      currentIndex,
      count: SOURCE_TABS.length,
      vertical: false,
    });
    if (nextIndex === null) return;
    e.preventDefault();
    const target = SOURCE_TABS[nextIndex];
    setTab(target.key);
    document.getElementById(`modFilter-source-${target.key}`)?.focus();
  };

  return (
    <div data-el="modFilter.source" role="tablist" className={className} style={style}>
      {SOURCE_TABS.map((t, idx) => {
        const selected = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            id={`modFilter-source-${t.key}`}
            role="tab"
            data-part="tab"
            aria-selected={selected}
            data-state={selected ? "selected" : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ModFilterSearch({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const tab = useModFilterStore((s) => s.tab);
  const query = useModFilterStore((s) => s.query);
  const setQuery = useModFilterStore((s) => s.setQuery);
  const searchLoading = useModFilterStore((s) => s.searchLoading);

  const showIcon = options?.showIcon === true;
  const busy = tab === "workshop" && searchLoading;
  const states = [query.trim() ? "filled" : "", busy ? "busy" : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div data-el="modFilter.search" data-state={states} className={className} style={style}>
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={Search} className="size-3" />
        </span>
      )}
      <input
        data-part="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchPlaceholder(tab)}
        aria-label="Search mods"
      />
    </div>
  );
}

function ModFilterSummary({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const selection = useModFilterStore((s) => s.selection);
  const meta = useModFilterStore((s) => s.meta);
  const showThumbnails = options?.showThumbnails !== false;

  const { included, excluded } = pickSummary(selection);
  const total = included.length + excluded.length;

  if (total === 0) {
    return (
      <div data-el="modFilter.summary" data-state="empty" className={className} style={style}>
        Nothing selected
      </div>
    );
  }

  const picks = [
    ...included.map((id) => ({ id, pick: "include" as const })),
    ...excluded.map((id) => ({ id, pick: "exclude" as const })),
  ];
  const shown = picks.slice(0, 4);
  const more = total - shown.length;

  return (
    <div data-el="modFilter.summary" className={className} style={style}>
      {showThumbnails && (
        <span data-part="thumbnails">
          {shown.map(({ id }) => (
            <span key={id} data-thumb={id}>
              <SummaryThumb id={id} title={meta[id]?.title ?? id} previewUrl={meta[id]?.previewUrl ?? null} />
            </span>
          ))}
          {more > 0 && <span data-part="more">+{more}</span>}
        </span>
      )}
      <span data-part="counts">
        {included.length > 0 && `${included.length} included`}
        {included.length > 0 && excluded.length > 0 && " · "}
        {excluded.length > 0 && `${excluded.length} excluded`}
      </span>
    </div>
  );
}

function ModFilterMatchMode({ className, style }: { className?: string; style?: CSSProperties }) {
  const mode = useModFilterStore((s) => s.mode);
  const setMode = useModFilterStore((s) => s.setMode);

  return (
    <div data-el="modFilter.matchMode" role="radiogroup" className={className} style={style}>
      <button
        type="button"
        id="modFilter-matchMode-any"
        data-part="option"
        role="radio"
        aria-checked={mode === "any"}
        data-state={mode === "any" ? "selected" : undefined}
        onClick={() => setMode("any")}
      >
        Match any
      </button>
      <button
        type="button"
        id="modFilter-matchMode-all"
        data-part="option"
        role="radio"
        aria-checked={mode === "all"}
        data-state={mode === "all" ? "selected" : undefined}
        onClick={() => setMode("all")}
      >
        Match all
      </button>
    </div>
  );
}

/** Every `modFilter.*` element; `undefined` for anything else. */
export function renderModFilterElement(
  node: ElementNode,
  { className, style }: { className?: string; style?: CSSProperties },
): ReactNode | undefined {
  switch (node.element) {
    case "modFilter.apply":
      return <ModFilterApply className={className} style={style} />;
    case "modFilter.cancel":
      return <ModFilterCancel options={node.options} className={className} style={style} />;
    case "modFilter.clear":
      return <ModFilterClear options={node.options} className={className} style={style} />;
    case "modFilter.source":
      return <ModFilterSource className={className} style={style} />;
    case "modFilter.search":
      return <ModFilterSearch options={node.options} className={className} style={style} />;
    case "modFilter.summary":
      return <ModFilterSummary options={node.options} className={className} style={style} />;
    case "modFilter.matchMode":
      return <ModFilterMatchMode className={className} style={style} />;
    default:
      return undefined;
  }
}
