---
title: One data root per copy, chosen by a marker file
type: memory
confidence: high
source: agent-session-2026-08-03
applies_to: [src-tauri/src/paths.rs, src-tauri/src/window_state.rs]
expires: 2026-11-03
summary: >
  Everything the launcher persists now lives in one directory resolved by
  src-tauri/src/paths.rs — the exe's folder when portable.txt sits beside it,
  %LOCALAPPDATA%\com.tetra.launcher otherwise. Window geometry moved into
  settings.json because tauri-plugin-window-state could not be pointed at that
  directory.
---

Replaces the previous arrangement, where `tetra.db*` and `settings.json` sat in
`%APPDATA%\com.tetra.launcher` (Roaming) and nothing said so anywhere a user
would look.

## Decisions worth not re-litigating

**Program Files was ruled out.** The NSIS `installMode` defaults to
`currentUser`, so the installer targets `%LOCALAPPDATA%\Tetra Launcher` without
admin. Going `perMachine` requires elevation at install time, leaves Program
Files unwritable for a standard user afterwards, and would put a UAC prompt on
every auto-update — which is the thing the signing setup exists to avoid.
`ProgramData` was declined too: new files there are writable only by their
creator, and it would make the registry machine-wide rather than per-user.

**Installed copies keep their data outside the install tree.** The uninstaller
removes that tree and the updater re-runs the installer, so a database beside
the exe is a database an update can take with it.

**Portable mode is opted into by `portable.txt`, never inferred from location.**
A location heuristic would make every `tauri dev` and `target/debug` run write
its own database again — the exact bug the comment at `lib.rs` describes.
`is_installed_copy` in `commands::update` returns false for dev builds, which is
why it is not reused for this.

**A portable copy never migrates.** The legacy directory is per-user and shared
with whatever is installed on the machine, so adopting it would move an
installed launcher's database into the unpacked zip folder.

## Two things found by running it, not by testing it

Both were caught only with a real exe; neither is reachable from
`cargo test`.

1. tao emits no `Moved` or `Resized` for a window that is merely created and
   shown. A session where nobody dragged the window left the geometry cache
   empty and the exit write with nothing to save. The cache is now seeded from
   the live window at the end of `setup`.

2. **Maximised state had to be restored after `apply_ui_scale`.** That function
   calls `set_min_size`, which tao implements as a `SetWindowPos`, and on a
   maximised window that silently clears the maximised state — its own doc
   comment says so. Restoring maximise before it meant the window came back the
   right size with `maximized: false`, so the next exit recorded the screen
   dimensions as the user's chosen size. **This bug predates the change** — the
   retired plugin restored before `setup` and hit the same ordering — so the
   rewrite fixes it rather than causing it.

## Loose end

`release.yml` now writes `portable.txt` into the portable zip. Anyone holding a
portable zip from **v1.2.0 or earlier** has no marker, so that copy will use
per-user app data until they add the file themselves.
