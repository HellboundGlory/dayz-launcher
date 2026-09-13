import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  /** 0-based. */
  page: number;
  totalPages: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
}

const PAGER_BUTTON =
  "inline-flex h-6 w-6 items-center justify-center rounded-[5px] border border-line bg-surface2 text-muted2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export function Pagination({
  page,
  totalPages,
  totalCount,
  onPrev,
  onNext,
}: PaginationProps): JSX.Element {
  const pageLabel = String(page + 1).padStart(2, "0");
  const totalLabel = String(totalPages).padStart(2, "0");

  return (
    <div className="mt-2.5 flex items-center justify-end gap-2.5 border-t border-line pt-2.5">
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 0}
        aria-label="Previous page"
        className={PAGER_BUTTON}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <p className="font-mono-data text-[10px] uppercase tracking-wider text-muted2">
        Page {pageLabel} / {totalLabel} · {totalCount} installed
      </p>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages - 1}
        aria-label="Next page"
        className={PAGER_BUTTON}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}
