import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { emit, listen } from "@tauri-apps/api/event";
import { SplashScreen } from "./components/splash-screen";
// `SplashScreen` is styled entirely in Tailwind, so this window needs the same
// stylesheet the launcher does — without it every class is dead and the splash
// collapses into unstyled text in the top-left corner. `splash.css` follows it
// to put the transparent body back; see the note in that file.
import "./main.css";
import "./splash.css";

/** What the main window publishes (`App.tsx`) as startup advances. */
interface SplashProgress {
  status: string;
  detail?: string;
  pct: number;
}

/**
 * The splash window's root.
 *
 * This is a second, much smaller window shown over the desktop while the
 * launcher (the hidden `main` window) boots. It is deliberately lightweight —
 * all the startup work happens in `main`; this page just renders the branded
 * splash and repaints it from `splash-progress` events until `main` closes us.
 */
function SplashRoot() {
  const [progress, setProgress] = useState<SplashProgress>({
    status: "Starting…",
    pct: 0,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<SplashProgress>("splash-progress", (event) => {
      setProgress(event.payload);
    }).then(
      (fn) => {
        unlisten = fn;
        // Announce ourselves only once the listener is actually registered.
        // `main` emits each milestone once as it reaches it, so everything that
        // happened before this line is lost; it answers this with whatever
        // milestone startup is on now. Without it a fast start leaves the bar
        // reading "Starting… 0%" until the window closes.
        void emit("splash-ready");
      },
      (e) => console.error("Splash could not subscribe to progress:", e),
    );
    return () => unlisten?.();
  }, []);

  return (
    <SplashScreen
      status={progress.status}
      detail={progress.detail}
      pct={progress.pct}
    />
  );
}

ReactDOM.createRoot(document.getElementById("splash-root")!).render(
  <SplashRoot />,
);

// Drop the pre-mount fallback. It is `position: fixed; inset: 0`, so leaving it
// in place would keep a second, centred "TETRA Launcher" painted on top of the
// real splash for the life of the window. No MutationObserver needed as in
// `index.html` — this module *is* what mounts the root.
document.getElementById("splash-fallback")?.remove();
