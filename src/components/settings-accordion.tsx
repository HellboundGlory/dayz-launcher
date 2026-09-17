import { useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsAccordionProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Roving-arrow navigation across the accordion headers. */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** The theme slot this whole section belongs to, and the child id for its
   * own toggle header — passed by the caller, since this component is shared
   * across sections that each map to a different slot. */
  tetraSlot?: string;
  tetraToggleEl?: string;
}

/**
 * One Settings section (`.sec`) — collapsing accordion, one open at a time
 * (the parent owns the open id). Header is a `<button aria-expanded>` with
 * `aria-controls`; ArrowUp/Down + Home/End rove across the headers (handled by
 * the parent via `onKeyDown`), Enter/Space toggles.
 */
export function SettingsAccordion({
  id,
  icon,
  title,
  description,
  open,
  onToggle,
  onKeyDown,
  children,
  tetraSlot,
  tetraToggleEl,
}: SettingsAccordionProps) {
  const bodyId = `settings-acc-${id}`;
  const headerRef = useRef<HTMLButtonElement>(null);

  return (
    <section
      data-tetra-slot={tetraSlot}
      className={cn("sec overflow-hidden [border-radius:var(--t-radius-panel)] border border-line bg-surface", open && "open")}
    >
      <button
        ref={headerRef}
        id={`settings-acc-h-${id}`}
        data-acc-header
        data-tetra-el={tetraToggleEl}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        aria-expanded={open}
        aria-controls={bodyId}
        className="sec-h flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-surface2"
      >
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-muted2">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block [font-size:var(--t-type-subheading-size)] font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block truncate [font-size:var(--t-type-label-size)] text-muted">{description}</span>
        </span>
        <span
          className={cn(
            "flex shrink-0 text-muted transition-transform [transition-duration:var(--t-motion-expand-duration)]",
            open && "rotate-180",
          )}
        >
          <ChevronDown className="h-[14px] w-[14px]" />
        </span>
      </button>
      <div
        id={bodyId}
        role="region"
        aria-labelledby={`settings-acc-h-${id}`}
        className={cn("sec-b px-4 py-4", open && "border-t border-line")}
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}
