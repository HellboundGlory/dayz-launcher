// First, so main.css fixes the cascade layer order before any other stylesheet loads.
import "./main.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CrashBoundary, installCrashLogging } from "./components/crash-screen";
import { logClient } from "./lib/tauri";
import { useThemeStore } from "./theme/theme-store";

// Paint the active theme before first render.
useThemeStore.getState().hydrate();

// Suppress the native webview context menu ("Back", "Reload", "Inspect") —
// it makes no sense inside a desktop app shell. A custom in-app menu can
// stopPropagation() on its trigger to opt out.
document.addEventListener("contextmenu", (e) => e.preventDefault());

// Render-independent failures never reach the boundary; log them all the same.
installCrashLogging(window, (level, message) => void logClient(level, message));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </React.StrictMode>,
);