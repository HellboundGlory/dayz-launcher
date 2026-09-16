# Which screens themes can lay out

ADR-0001 capped Settings, first-run setup and Steam required below full composition so a misleading layout couldn't cause harm there. v2 instead opens the shell, both views, Settings, every popup and the server info, mod filter and update modals to full layout and CSS, protected by required elements and the visibility check (ADR-0011) rather than caps.

Steam required and first-run setup stay launcher-owned because they are the way out of a blocked launcher and a broken theme must never bury them. The Activation Safety Window must render correctly under a broken theme, and the splash appears before any theme has loaded.

## Consequences

Launcher-owned screens that render inside the main window (Steam required, first-run setup) still use the active theme's colour and type tokens, but no theme layout or CSS can reach them. The Activation Safety Window and the splash use fixed Neutral colours.

Inside screens that are otherwise themeable, theme management and destructive confirmations stay launcher-owned in the same way (ADR-0024).

Settled in the 2026-09-15 design session: Q5, Q69. Supersedes the caps in ADR-0001.

## Status
accepted
