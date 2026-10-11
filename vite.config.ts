/// <reference types="vitest/config" />
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The triple-slash reference above lets Vitest type-check the `test` block
// below, so `palette.test.ts` runs through the same config as the rest of the build.
export default defineConfig({
  test: {
    environment: "node",
  },
  clearScreen: false,
  server: {
    strictPort: true,
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Each separate window (splash, theme-guard) gets its own entry alongside index.html.
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        splash: path.resolve(import.meta.dirname, "splash.html"),
        "theme-guard": path.resolve(import.meta.dirname, "theme-guard.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [react()],
});