import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { emit, listen } from "@tauri-apps/api/event";
import { SplashScreen } from "./components/splash-screen";
// Needs the launcher's Tailwind stylesheet too, or every class is dead here.
import "./main.css";
import "./splash.css";

/** What the main window publishes (`App.tsx`) as startup advances. */
interface SplashProgress {
  status: string;
  detail?: string;
  pct: number;
}

// Splash window's root — just renders the branded splash and repaints it
// from splash-progress events; all startup work happens in `main`.
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
        // Announce only once listening — `main` replies with whatever
        // milestone it's currently on, since earlier ones are already gone.
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

// Drop the pre-mount fallback so it doesn't stay painted over the real splash.
document.getElementById("splash-fallback")?.remove();
