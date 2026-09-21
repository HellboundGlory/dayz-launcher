import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useModsStore, visibleRows } from "@/stores/mods-store";
import { steamModStates, steamDownloadProgress, type ModState } from "@/lib/tauri";

interface PollActions {
  setLive: (states: Record<string, ModState>) => void;
  setProgress: (progress: Record<string, { downloaded: string; total: string }>) => void;
  load: (force?: boolean) => Promise<void>;
}

/** 1.5s live-state/progress poll; reloads the rows once a download finishes. */
export function startModsPoll(ids: string[], { setLive, setProgress, load }: PollActions): () => void {
  let cancelled = false;
  let prevStates: Record<string, ModState> = {};

  async function poll() {
    try {
      const [entries, progress] = await Promise.all([
        steamModStates(ids),
        steamDownloadProgress(ids),
      ]);
      if (cancelled) return;
      const nextStates = Object.fromEntries(entries.map((e) => [e.workshop_id, e.state]));
      const finishedDownload = entries.some(
        (e) => e.state === "ready" && prevStates[e.workshop_id] === "downloading",
      );
      prevStates = nextStates;
      setLive(nextStates);
      setProgress(
        Object.fromEntries(
          progress.map((p) => [p.workshop_id, { downloaded: p.downloaded, total: p.total }]),
        ),
      );
      if (finishedDownload) {
        void load(true);
      }
    } catch {
      /* next tick */
    }
  }

  void poll();
  const timer = setInterval(() => void poll(), 1500);
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}

/** Load on mount, then poll live state/progress. Shared by both Mods views. */
export function useModsLifecycle() {
  const { rows, load, loadCaredServers, setLive, setProgress } = useModsStore(
    useShallow((s) => ({
      rows: s.rows,
      load: s.load,
      loadCaredServers: s.loadCaredServers,
      setLive: s.setLive,
      setProgress: s.setProgress,
    })),
  );

  useEffect(() => {
    void load();
    void loadCaredServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ids = visibleRows(rows).map((r) => r.workshop_id);
    if (ids.length === 0) return;
    return startModsPoll(ids, { setLive, setProgress, load });
  }, [rows, setLive, setProgress, load]);
}
