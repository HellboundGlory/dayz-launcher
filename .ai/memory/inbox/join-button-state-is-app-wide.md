---
title: The join button names the outcome, and its state is app-wide
type: memory
confidence: high
source: agent-session-2026-08-03
applies_to: [src/stores/launch-store.ts, src/lib/join-action.ts, src/components/server-details.tsx, crates/tetra-launch/src/running.rs]
expires: 2026-11-03
summary: >
  The verify/download/launch operation moved out of server-details.tsx into a
  store, so it survives switching servers and renders on every server's panel.
  The button names the outcome (JOIN) and never the mechanism; verification
  runs on every press underneath.
---

## The three things that were wrong

**The button named the mechanism instead of the outcome.** It read
`VERIFY & JOIN`, and with auto-join off, `VERIFY`. Verification is housekeeping
on the way to joining — not something the player asked for — and putting it on
the button forced the label to track an implementation detail. When the check
then discovered a stale mod, the handler downloaded it and stopped short of
launching, so the label had promised a join it would not perform.
`arrivingCount` already covers mods Steam *knows* are stale, so the
over-promise was confined to the one branch where staleness is discovered
mid-check. That is the "positive stale branch" progress.md records as never
proven; it fired for real and this is what it looked like.

The button now reads **`JOIN`** whenever nothing visible needs doing, whatever
the setting says, and the check runs unconditionally underneath. The two
download labels stay, because they describe work already visible in the mod
list. `readyText`, the line under the button, is where the verification is
explained now.

A first attempt at this added a two-press model — a `verified` set, a
`straightToJoin` flag, `VERIFY` then `JOIN`. All of it existed only to keep a
mechanism-shaped label honest, and all of it was deleted once the label named
the outcome. The genuinely minimal fix to the original bug was a rename.

**Switching servers cancelled the work.** The effect keyed on
`selectedServer.addr` flipped the cancel flag, on the reasoning that the wait
would otherwise launch a server the user had navigated away from. It could not:
`handleVerifyAndJoin` captures its address up front. All the cancel achieved was
abandoning a download the instant anyone clicked another row, while Steam
carried on downloading with nothing on screen to say so.

**`LAUNCHING...` was unreachable.** `busy === "fixing"` replaced the button for
the whole operation including the launch, so the `launching` flag was set and
cleared behind a box that never rendered it. Every phase looked like one generic
spinner, which is why a failed launch was reported as "goes to launching then
back to verify and join" — there was nothing on screen to distinguish
verifying from launching from failing.

## What replaced them

`stores/launch-store.ts` holds one operation, app-wide — Steam has one download
queue and the machine runs one DayZ, so a second concurrent launch is not a
thing to represent, it is a thing to prevent. Phases are
`verifying → subscribing → downloading → launching → starting`, and the panel
renders whichever is live with a caption naming its server when you are looking
at a different one.

`lib/join-action.ts` is the label rule as a pure function, so the label and the
behaviour are read from the same place. **There is no JS test runner in this
repo** (`npm run build` is `tsc --noEmit && vite build`), which is why this is
extracted but not unit-tested — adding vitest was out of scope. Two of the three
bugs ever recorded against this button shipped because nothing in CI clicks it;
a test runner is the obvious next investment.

## PLAYING is real process detection

`tetra-launch::running` polls for `DayZ_x64.exe` via `sysinfo` every 4s —
**not** `DayZ_BE.exe`, which is the BattlEye stub that exits seconds after
handing off. It replaces a 15-second timer, and being an OS question rather than
an inference it is also correct for a session started from Steam directly or one
that outlived a launcher restart.

## Verified by driving the real UI

All of the above was confirmed against the running launcher on 2026-08-03:
`JOIN` on an all-ready server with auto-join off, the positive stale branch
finding an update and stopping rather than launching, a press launching DayZ,
`PLAYING` appearing and clearing when DayZ exited, and `STARTING DAYZ…`
captioned "for GulagZ…" rendering while a *different* server was selected.
