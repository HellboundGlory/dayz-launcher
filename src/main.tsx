import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { useThemeStore } from "./theme/theme-store";
import "./main.css";

// Paint the active theme before first render. The theme engine is CSS-driven:
// it writes the palette as custom properties on <html>, so re-theming costs one
// style write and no component re-renders.
useThemeStore.getState().hydrate();

// The launcher runs in a webview, and the native browser context menu ("Back",
// "Reload", "Inspect") makes no sense inside a desktop app shell. Suppressed
// globally rather than per-component so nothing has to remember to do it; a
// custom in-app context menu, when one exists, can `stopPropagation()` on its
// own trigger element to be exempted from this.
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);