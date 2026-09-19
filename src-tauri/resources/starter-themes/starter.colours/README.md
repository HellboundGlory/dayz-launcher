# Colours only

The smallest possible theme: a manifest and a palette, nothing else. Copy this
folder as the start of a theme that only wants to change colour.

## Files

- **`theme.json`** — the manifest. `id` must match the folder name and is what
  the launcher's themes folder uses to store this theme; `capabilities` must
  list exactly the files this package ships (here, just `tokens`). Change
  `name`, `author`, `version` and `description` to your own before sharing it.
- **`tokens.json`** — the palette. Declares the `colors` capability's twelve
  tokens (`bg`, `surface`, `surface2`, `border`, `text`, `muted`, `muted2`,
  `accent`, `accent2`, `success`, `warn`, `danger`) for both `dark` and
  `light`, each a `#rrggbb` string. The launcher derives hover states, soft
  fills and lines from these automatically — you never set those yourself.
  Everything else (`scales`, `roles`) is optional and falls back to Neutral's
  values, so you can add just the pieces you want to change.

## Checking your palette

Dev Mode (Settings → Theme Management) shows a live contrast check against
this theme once it is installed. Keep `text` on `bg`/`surface`, and `muted`
on `surface`, at or above a 4.5:1 contrast ratio in both colour schemes —
below that the check warns, and below 3.0:1 it errors.
