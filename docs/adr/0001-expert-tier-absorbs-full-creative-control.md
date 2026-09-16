# Expert tier absorbs full creative-control scope; no fourth tier

The theme system was being extended to give theme authors near-total presentational freedom (free positioning, decorative images) across essentially every slot, not just `server.row`/`mods.row`. The obvious shape was a new fourth tier above Expert (considered under the working name "Canvas tier"), but since the theme system has not shipped to any user yet, there was no compatibility reason to keep a narrower Expert tier around. We folded the expanded scope directly into Expert instead: one `tier: "expert"` declaration, composition now legal on every `full` slot.

Three slots are capped below Expert regardless of this: `modal.steamRequired`, `modal.onboarding`, and `settings.*`. These are recovery/configuration surfaces where a *plausible-looking* but subtly misleading layout (e.g. decorative art crowding a Retry or Save action) causes real harm and would not necessarily trigger the Theme Activation Safety Window, which only catches themes that render as visibly broken.

## Status
superseded by ADR-0004 (tiers) and ADR-0008 (which screens themes can lay out)
