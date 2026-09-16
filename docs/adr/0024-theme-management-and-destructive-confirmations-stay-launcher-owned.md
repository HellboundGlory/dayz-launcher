# Theme management and destructive confirmations stay launcher-owned

Settings and Mods are themeable (ADR-0008), but two parts of them are not:
- **Settings' theme management:** the theme list, Reset to Default, import and export, the token customiser and the Dev Mode switch. It is how a user escapes a bad theme.
- **Every destructive confirmation:** deleting a theme, unsubscribing mods, cleaning up removed mods, and unsubscribing a server's unique mods. A misleading layout here would do real, irreversible damage.

A theme can place theme management only as one whole launcher-owned block, and confirmations always open in the launcher's own dialog. Neither takes theme layout or CSS; both use only the active theme's colour and type tokens.

Opening them to layout and CSS like the rest of their screens, protected only by required elements, was rejected. The visibility check can prove a button is visible, but not that the text and layout around it tell the truth.

Settled in the 2026-09-15 design session: Q74.

## Status
accepted
