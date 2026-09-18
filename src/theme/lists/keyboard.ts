import type { KeyboardEvent } from "react";

export function handleListKeyDown({
  event,
  itemCount,
  selectedIndex,
  onSelectIndex,
  onClearSelection,
}: {
  event: KeyboardEvent<HTMLElement>;
  itemCount: number;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onClearSelection: () => void;
}) {
  if (itemCount === 0) return;

  switch (event.key) {
    case "ArrowDown": {
      event.preventDefault();
      const next = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, itemCount - 1);
      onSelectIndex(next);
      break;
    }
    case "ArrowUp": {
      event.preventDefault();
      const next = selectedIndex < 0 ? itemCount - 1 : Math.max(selectedIndex - 1, 0);
      onSelectIndex(next);
      break;
    }
    case "Home": {
      event.preventDefault();
      onSelectIndex(0);
      break;
    }
    case "End": {
      event.preventDefault();
      onSelectIndex(itemCount - 1);
      break;
    }
    case "Escape": {
      event.preventDefault();
      onClearSelection();
      break;
    }
    case "Enter": {
      // Enter never joins; keep stray keypress from launching DayZ
      event.preventDefault();
      break;
    }
  }
}
