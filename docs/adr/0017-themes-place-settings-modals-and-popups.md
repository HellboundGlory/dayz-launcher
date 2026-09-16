# Themes place Settings, modals and popups; the launcher keeps their behaviour

A theme decides where Settings appears (as a view, as an overlay over a region, or as a panel), where each modal sits and whether it has a backdrop, and where each popup opens: anchored to its trigger, inside a region, or inline. The launcher keeps everything that is behaviour — opening and closing, focus trapping, Esc and outside-click dismissal, background scroll lock, and returning focus — and flips or shifts anchored popups so they always stay on-screen.

We rejected keeping this placement launcher-owned, because authors wanted that freedom. We also rejected pure theme positioning with no on-screen protection, because a theme could strand a menu off-window with nothing the user could do about it.

Settled in the 2026-09-15 design session: Q20, Q40, Q41, Q42.

## Status
accepted
