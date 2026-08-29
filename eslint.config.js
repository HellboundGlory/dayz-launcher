// T1 (2026-08-29 audit): no lint config existed at all, despite six
// `// eslint-disable-next-line react-hooks/exhaustive-deps` comments already
// in the source — suppressing a rule that wasn't running. `react-hooks` is
// the focus here rather than the plugin's full "recommended" bundle: recent
// major versions ship a much larger React-Compiler-oriented rule set
// (immutability, purity, set-state-in-render, …) that this codebase was
// never written against, and pulling all of it in now would bury the two
// rules that actually matter — C1 and H2 were both stale-closure bugs of
// exactly the kind `exhaustive-deps` catches — under unrelated noise.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "target/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // The "destructure to exclude a few keys from a rest spread" idiom
      // (`const { a, b, ...kept } = x`) reads `a`/`b` only to drop them —
      // `server-store.ts`'s `persistFilter` is exactly this, and is a
      // legitimate pattern, not a mistake.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
);
