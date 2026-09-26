import type { CSSProperties, MouseEvent } from "react";
import { X } from "lucide-react";
import { useElementContext } from "./context";
import { OptionIcon } from "./option-icon";

export function ModalClose({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { closeModal } = useElementContext();

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    closeModal();
  };

  return (
    <button
      type="button"
      data-el="modal.close"
      onClick={handleClick}
      aria-label="Close"
      className={className ?? "text-muted hover:text-ink"}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={X} className="size-3.5" />
      </span>
    </button>
  );
}
