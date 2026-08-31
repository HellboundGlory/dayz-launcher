import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { useThemeStore } from "./theme/theme-store";
import "./main.css";

// Paint the active theme before first render.
useThemeStore.getState().hydrate();

// Suppress the native webview context menu ("Back", "Reload", "Inspect") —
// it makes no sense inside a desktop app shell. A custom in-app menu can
// stopPropagation() on its trigger to opt out.
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);