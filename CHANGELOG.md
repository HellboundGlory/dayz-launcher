# Changelog

## v1.0.2 — 2026-08-02

### Added

- **A Launcher section in Settings**, with the window and startup behaviour that
  had no home before:

  - **Close to tray.** The close button hides the launcher instead of quitting;
    a tray icon restores it, and its menu quits properly. *This setting already
    existed and was on by default — it simply did nothing, because there was no
    tray and closing always exited.*
  - **When you join a server** — leave the launcher open (what it has always
    done), hide it to the tray, or close it. It waits a few seconds first, so
    the launcher does not vanish before DayZ has put a window up.
  - **Start with Windows**, and **start minimised** alongside it. Opening the
    launcher yourself always shows the window, whatever start-minimised says.

- **Custom launch parameters** now have a field, on the Game section. The
  plumbing was fixed in v1.0.0 and has worked ever since — there was just no way
  to type one in.

- **Auto-refresh** on the Server Browser section: never, or every 30 seconds to
  10 minutes. It re-queries only the rows on screen, and skips a tick while a
  previous refresh is still running or the launcher is hidden. *Also a setting
  that already persisted, defaulting to 60 seconds, with no refresh behind it.*

### Fixed

- **The launcher opened far more simultaneous connections than a home network
  is comfortable with.** The limit was 1024, chosen from a measurement that ran
  over loopback — which has no router, no NAT table and no ISP in the path. On a
  real connection that many concurrent queries can have entries pushed out of a
  router's NAT table mid-exchange, and a dropped reply is indistinguishable from
  a server that never answered: the row just reads offline. It is now 256.

  `maxConcurrentQueries` and `queryTimeoutMs` in `settings.json` were also being
  saved and then ignored entirely; both are now read at startup, and clamped so
  a hand-edited value cannot exhaust the connection budget.

### Changed

- **Settings has been reorganised into tabs** — Game, Server Browser and
  Updates — in a larger window. Every control now sits under a heading that
  says what it affects, the explanatory lines are a single sentence each, and
  the window keeps one height as you move between tabs instead of resizing
  under the cursor.

  Escape and a click outside now close it, the section list is reachable with
  the arrow keys, and a long section scrolls inside the window rather than
  running off the screen.

  Secondary text was lightened. At the size these hints run, the old grey
  measured 3.7:1 against the panel — under the 4.5:1 needed to be comfortably
  readable.

- **The ENGLISH ONLY tag moved out of TAGS and into Settings → Server
  Browser**, as a *Language* dropdown next to the other two name-based filters.
  All three noise filters are now in one place, and language is the only one of
  them that persists between sessions, which made it the odd one out in a menu
  of temporary view filters.

  The three states are unchanged, just named: **English servers only** (the
  default), **Non-English servers only**, and **All languages**.

- **"Hide default hoster names" now hides every server with a hosting company in
  its name**, not just the ones that were never named at all. `4Netplayers
  Purgatorio [ESP]` and `GRAGOLL nitrado.net` go the same way as
  `nitrado.net gameserver`. Turn the setting off to see them.

  A name with the hosting company credited *after a separator* —
  `Stoned and Afraid PVE - By Pingperfect.com`, `Papaws Livonia by
  HostHavoc.com` — is judged on the rest, since that is a name its admin chose
  in full. `DayZ Server by HostHavoc.com` is still hidden: strip the credit and
  nothing is left.

  On a real 8,858-server list this hides 178 rows, up from 150.

- **The ENGLISH ONLY tag is now on by default**, and remembers where you left
  it across restarts. Set it to blank in the TAGS dropdown to see every
  language again, and that choice now sticks.

- **ENGLISH ONLY now filters by language, not just alphabet.** It used to hide
  only names written in another script — Chinese, Russian, Korean — so German,
  French, Spanish, Polish and Brazilian servers came through, because those are
  written in the same alphabet as English. It now also recognises:

  - a bracketed language or country tag — `[GER]`, `[RU]`, `[BR]`, `[FR]`,
    `[PL]`, `[ESP]`. A name that also carries `[EU]`, `[US]` or `[UK]` is
    exempt from this test;
  - letters English does not use — `Gebirgsjäger`, `Español`, `Připoj`;
  - a single Chinese, Japanese, Korean, Thai, Hebrew or Arabic character
    anywhere in the name, however much English surrounds it —
    `BX公益服|PVP仿官|Vanilla+` is only 29% Chinese by character count;
  - a list of common non-English words, which is what catches
    `Zwiebelmett mit Guerkchen`, `Morra com Honra` and
    `LATAMDESERT | 4 ZONAS PVP | AUTOS REALISTAS`.

  Set the tag to ✗ to see only those servers, or blank for everything.

  Detection is entirely offline and reads only the server's name — nothing is
  sent anywhere. A server that is German but says so nowhere in its name will
  still get through.

### Fixed

- **ENGLISH ONLY missed several tags sharing one bracket.** `[CZ/SK]`,
  `[GER/PVE]`, `[EU|FR]`, `[FR-QC]` and `(PVE-GER)` were each read as a single
  opaque tag, so none of them matched a language. On a real 6,785-server list
  this alone accounted for **73 non-English servers** showing under ENGLISH
  ONLY — more than every gap in the word list put together. Tags now split on
  their separators.

  A server that advertises an English audience alongside its own language —
  `[GER/EN]`, `[RU/EN]`, `[PL/EN]` — stays visible, which is the point of
  splitting rather than simply matching harder.

  Three country codes came out of the list as a consequence: `AT`, `BY` and
  `SA` now read as the English words they usually are — *Enter **At** Own
  Risk*, *Hostet **by** ACEVontex* — and `[SA]` in DayZ means *Standalone*.

- **`é` was not treated as a foreign letter**, while `è`, `ê` and `ë` all were.
  The commonest accented letter in French, Spanish and Portuguese was the one
  missing, which is what let `Québec Vanilla`, `Serv Privé` and
  `Révélation 13` through.

- **A Russian name padded with English could beat the alphabet test.**
  `!*ВДАЛИ от ЖЁН Chernarus*! 1 [PVE] [vk.com/vdzh_pve]` is 29% Cyrillic by
  character, against a 30% cut — the map name, the mode tag and the URL drag it
  under. Cyrillic and Greek are now judged a word at a time, so a name
  containing a Russian *word* is Russian however much English surrounds it. A
  Latin word wearing one decorative Cyrillic letter — `Чernarus Survival` — is
  still English.

  Together these hide 103 more servers, leaving 5,347 of 6,605 named servers
  visible by default.

## v1.0.1 — 2026-08-01

### Fixed

- **JOIN gave no sign it had worked.** The button stayed on "JOIN SERVER" even
  while you were in the game. It now turns green and reads "DAYZ IS STARTING"
  for a few seconds after launching. (Introduced in v1.0.0 — removing the bug
  that pinned the button on "LAUNCHING..." for the whole session left nothing in
  its place.)

### Added

- **The server browser hides junk entries by default.** Roughly a quarter of
  every list was servers with no name at all — ones Steam lists but that have
  never answered a query — plus hosting-company defaults like
  `nitrado.net gameserver`, `Hosted by GTXGaming.co.uk` and `EXAMPLE NAME`. On a
  typical list that is about 2,200 rows of nothing. Both are checkboxes under
  **Settings → Server Browser** if you want them back.

  Servers whose admin kept the hoster prefix but did name the thing —
  `4Netplayers Purgatorio [ESP]` — are *not* hidden.

- **An ENGLISH ONLY tag** in the TAGS dropdown, for filtering by the script a
  server's name is written in. Off by default. ✓ shows only names you can read
  in the Latin alphabet, ✗ shows only the ones you can't, blank shows
  everything.

### Changed

- The TAGS chip now counts excluded tags as well as included ones. Setting a tag
  to ✗ previously still showed "Any".

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
