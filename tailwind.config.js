/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  // Only `src` exists — the pages/components/app globs were scaffolding from
  // the shadcn starter this was generated from and matched nothing.
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        // V4 Glow semantic tokens. These resolve to CSS custom properties, so
        // the theme engine re-themes the whole app by rewriting the vars on
        // <html> — utilities stay bound to the live palette.
        bg: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface2)",
        line: "var(--border)",
        "line-weak": "var(--border-weak)",
        ink: "var(--text)",
        muted: "var(--muted)",
        muted2: "var(--muted2)",
        "muted-soft": "var(--muted-soft)",
        accent: "var(--accent)",
        accent2: "var(--accent2)",
        "accent-soft": "var(--accent-soft)",
        "accent-line": "var(--accent-line)",
        "accent2-soft": "var(--accent2-soft)",
        "accent2-line": "var(--accent2-line)",
        success: "var(--success)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
        "danger-line": "var(--danger-line)",
        "warn-soft": "var(--warn-soft)",
        "row-hover": "var(--row-hover)",
        "row-selected": "var(--row-selected)",
      },
    },
  },
  // The `accordion-up`/`accordion-down` keyframes and the `tailwindcss-animate`
  // plugin that lived here drove Radix primitives. No Radix package is used any
  // more, and nothing in the app reaches for an `animate-in`/`fade-`/`zoom-`
  // utility — the only animations are core Tailwind's `animate-spin` and
  // `animate-pulse`.
  plugins: [],
};
