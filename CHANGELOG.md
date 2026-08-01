# Changelog

## v1.0.0 — 2026-08-01

A stability and performance release. No new features; the launcher does the
same things, more reliably and a lot faster.

### Fixed

- **Joining a server left the launcher stuck.** The JOIN button stayed on
  "LAUNCHING..." for as long as DayZ was open, and the server did not appear in
  RECENT until you quit the game.
- **Custom launch parameters were ignored.** They saved correctly and were then
  silently dropped before DayZ started.
- **REFRESH could fail entirely** because of a single bad server address in the
  list, updating nothing.
- **Filtering could show the wrong servers.** Changing a filter while a slower
  query was still running could leave the table showing results the filter
  should have excluded.
- The launcher no longer fails to start if the window's transparency effect is
  unavailable.
- If the server database cannot be opened, the launcher now says so instead of
  quietly forgetting your favourites when it closes.
- Download sizes are labelled consistently (KB/MB/GB) and no longer display
  "NaN" for unusual values.

### Improved

- **The window no longer freezes while the server list loads.** Database work
  moved off the interface thread, so scrolling and clicking stay responsive
  during a refresh or discovery.
- **Searching is much faster.** Typing used to run a full database query and a
  redraw on every single keypress.
- Server-list refreshes now respect one shared connection limit across the whole
  app, instead of each operation opening its own budget of network sockets.
- A join no longer waits behind a large refresh already in progress.
- Region lookup is resolved when the app is built rather than assembled in
  memory at startup.

### Internal

- Removed roughly 1,700 lines of unused code and 18 unused dependencies,
  including four Tauri plugins and their permissions — a smaller install and a
  smaller security surface.
- Added continuous integration: formatting, linting, tests and type checking now
  run on every push. Test count went from 93 to 102.

---

## v0.2.0 — 2026-08-01

- REFRESH now re-probes only the servers visible on screen rather than a broad
  backend-chosen window, and records an OFFLINE status for servers that do not
  answer.
- Added an indicator for servers whose mods have a Steam update pending.
- Disabled the native right-click context menu, which is a browser default with
  no use in a desktop app.

## v0.1.0 — 2026-08-01

- Initial public release: server browser, mod manager, pre-launch mod gate,
  virtualised server list, Steam connection-loss detection, clean shutdown, and
  the in-app updater.
