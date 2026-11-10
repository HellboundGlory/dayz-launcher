import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore, showToast, type Toast } from "./toast-store";

const sticky = (key: string, extra: Partial<Toast> = {}): Toast => ({
  key,
  tone: "warning",
  tag: "Mods",
  message: key,
  ...extra,
});
const shownKeys = () => {
  const { entries, hidden } = useToastStore.getState();
  return entries.map((e) => e.toast.key).filter((k) => !hidden.includes(k));
};

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ entries: [], closed: [], hidden: [], paused: false, produced: [] });
});
afterEach(() => vi.useRealTimers());

describe("toast store", () => {
  it("keeps a sticky toast from showToast when the notices change", () => {
    showToast(sticky("appimage"));
    useToastStore.getState().setNoticeToasts([sticky("modsError")]);
    expect(shownKeys()).toEqual(["appimage", "modsError"]);
  });

  it("shows a new quick toast over four sticky ones by hiding the oldest", () => {
    const onClose = vi.fn();
    useToastStore.getState().setNoticeToasts(["a", "b", "c", "d"].map((k) => sticky(k)));
    showToast(sticky("copied", { quick: true, onClose }));
    expect(onClose).not.toHaveBeenCalled();
    expect(shownKeys()).toEqual(["b", "c", "d", "copied"]);
  });

  it("gives a quick notice that comes back its full five seconds", () => {
    const onClose = vi.fn();
    const store = useToastStore.getState();
    store.setNoticeToasts([sticky("copied", { quick: true, onClose })]);
    vi.advanceTimersByTime(4000);
    store.setNoticeToasts([]);
    store.setNoticeToasts([sticky("copied", { quick: true, onClose })]);
    vi.advanceTimersByTime(4000);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with the newest callback a notice gave", () => {
    const first = vi.fn();
    const second = vi.fn();
    const store = useToastStore.getState();
    store.setNoticeToasts([sticky("error", { onClose: first })]);
    store.setNoticeToasts([sticky("error", { onClose: second })]);
    store.closeToast("error");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
