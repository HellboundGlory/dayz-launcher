# Changelog

## v1.9.0 — 2026-08-10

### Added

- **Fedora: `.rpm` package.** Alongside the AppImage and `.deb`, releases now
  also publish a `.rpm` for Fedora/RHEL-based systems.

### Fixed

- **Discord Rich Presence could still get stuck** in two more cases beyond
  the one fixed in v1.8.1: a hung connection to the Discord client (Discord
  crashed or was suspended mid-handshake) could freeze presence updates for
  the rest of the session, and a DayZ process left over from a crash or an
  improper close could make presence report "still playing" indefinitely.
  Both are now detected and recovered from automatically.
- **The splash screen could get stuck at 70%** if the local server database
  took a moment longer than usual to open — the very first checks could run
  before it was ready and never got retried. The launcher now retries once
  the database is actually ready instead of giving up.
- **(Linux) Installing an update silently stopped relaunching the app.** A
  recent crash fix changed how the launcher shuts down and, as a side effect,
  broke the auto-updater's restart step on Linux — the update would install
  but the launcher would just close instead of coming back. Fixed.

## v1.8.1 — 2026-08-10

### Fixed

- **Discord Rich Presence could get stuck on "Playing"** after a long DayZ
  startup (BattlEye, shader compilation, Proton on Linux can all take over a
  minute). A slow launch was misread as an already-finished session and the
  presence never recovered for the rest of the session.

## v1.8.0 — 2026-08-10

### Added

- **Discord Rich Presence.** Shows what you're doing in Discord — browsing
  servers, checking a server's mods before you join, or playing on one, with
  the map, player count and even whether it's day or night in-game. A
  "Join via Tetra Launcher" button lets a friend land on the same server
  from your Discord profile in one click.
- **Linux: `.deb` package.** Alongside the AppImage, releases now also
  publish a `.deb` for Debian/Ubuntu-based systems.
- **A [project website](https://tetralauncher.com/)**
  with downloads for every platform and the page the new Discord join links
  open.

### Fixed

- **"Open Data Folder" now works on Linux.** It only ever tried the Windows
  file explorer, so the button silently did nothing on the AppImage build.
- **Mods tab status filters** (Downloading, Outdated, etc.) now reflect what's
  actually happening live instead of a stale snapshot from the last load.
- **Dismissing the update banner** no longer leaves you with no way to
  install the update for the rest of the session — a small icon stays in the
  title bar as long as one is pending.
- **Manual refresh and the auto-refresh timer** no longer overlap and leave
  the refresh indicator out of sync with what's actually still running.

## v1.7.1 — 2026-08-09

### Fixed

- **The update dialog now shows the changelog.** Previously the "neat view of
  what's new" was always empty — the in-app changelog comes from the updater
  manifest, which was published without notes. Releases now ship the changelog
  inside the manifest, and the launcher falls back to the GitHub release notes
  when it's still missing, so updates always show something.

- **(Linux) Crash when closing.** The launcher could crash at exit on some
  NVIDIA/WebKit systems (heap-corruption detected while the system unloaded
  libraries during shutdown). The exit path now terminates after its own
  cleanup instead of running through that unload pass, and it stops in-flight
  Steam discovery cleanly before shutting down.

- **Details panel decluttered.** The per-server mod list is gone — your mod
  library lives in the MODS tab — and the "Manage mods" link sits under the
  Join button instead of floating mid-panel.

- **Mods tab.** Wildly better data on Windows too (a field-naming bug meant
  columns, dates and thumbnails stayed blank); the list now falls back to the
  last known snapshot when Steam/Workshop is unreachable, with a clear banner.

- **Crate versions now tracked properly.** Edited library crates are bumped per
  release, and the app crate version matches the release instead of a stale
  1.2.0.

### Internal

- Startup splash reliability: the server list refreshes the moment the launcher
  window becomes visible, and a log file (`tetra-launcher.log` in the data
  folder) captures discovery/reload timing for diagnosing startup hangs.

# Changelog

## v1.7.0 — 2026-08-09

### Added

- **A dedicated Mods tab.** A full-width MODS tab sits next to RECENT and
  manages every Workshop mod you're subscribed to: sortable Name, Subscribed,
  Updated and Size columns; preview thumbnails; live install status and
  download progress; search and one-click status filters; and a detail
  inspector with the description, tags, dates, sizes, rating, the install
  folder, and which of your favourite servers need the mod.

- **Verify mods.** Checks every — or only your selected — mod against the
  Workshop and re-downloads anything it has moved past or that isn't on disk
  yet, then reports exactly what happened.

- **Multi-select and bulk actions.** Checkboxes anywhere in the list plus bulk
  Verify, Unsubscribe selected/all, and **Clean up removed mods** for
  subscriptions the Workshop no longer knows about.

- **"Select unique to a server".** Picks the mods only one of your
  favourite / recently-played servers uses, so you can prune a server's
  exclusive mods without breaking another one.

- **Open in Steam.** A mod's Workshop page now opens inside the Steam client
  itself (focused and navigated), instead of a browser tab.

- **Offline resilience.** The tab caches the last known list and still shows
  it, clearly labelled, when Steam or the Workshop is unreachable.

### Fixed

- Unsubscribe and clean-up confirmations now use an in-app dialog instead of
  the browser's `confirm()`, which the Linux webview does not reliably show —
  the buttons previously worked on Windows and could silently do nothing on
  Linux.
- Mods data now round-trips end to end with the right field names, so every
  column, thumbnail and date populates (a first-build field-naming mismatch).

# Changelog

## v1.6.0 — 2026-08-07

### Added

- **Linux support (AppImage).** The launcher now ships as a Linux AppImage
  alongside the Windows installer, with the full Windows feature set: server
  browser, favourites and history, Steam workshop subscription and mod
  download, and one-click launch into modded servers via Proton.

- **Windows release unchanged.** The Windows NSIS build is the same
  application as before; Linux is an additional platform target, released
  from the same tag.

### Fixed (Linux)

- The launcher window now renders on Wayland/X11 (WebKit renderer fallback).
- DayZ launches under Proton with mods loaded correctly (Wine path
  translation), including BattlEye-enabled installs.
- The "PLAYING" state is detected for sessions running under Proton.

## v1.5.0 — 2026-08-07

### Added

- **Load button beside Join.** Starts DayZ at the main menu with a server's
  mods, without joining it.

- **Filters remembered between sessions**, with a Reset button to clear them.

- **Clear update notifications.** A banner appears when a new version is out,
  and the changelog is shown right in the launcher.

### Fixed

- **The launcher no longer pops back over the game** after you've hidden it to
  the tray.

## v1.4.0 — 2026-08-06

### Added

- **A proper splash screen while the launcher starts up.** Instead of an empty
  window, startup now shows a branded DayZ splash that reports what it is
  actually doing — connecting to Steam, fetching servers, loading maps — with
  a live server count and a progress bar. The launcher window appears once
  everything is ready.

- **A queue count on busy servers.** A server that reports players waiting to
  get in now shows them next to the player count, as an amber `+3`, in both
  the server list and the details panel. Servers that don't report a queue
  look exactly as they did.

- **A far more readable TIME column.** The in-game clock is now a 12-hour time
  with a ☀/☾ for day or night, plus the time-acceleration the server is
  running right now — `☀ 3:15 PM · 4x`. It picks the day or night multiplier
  to match the current phase rather than always showing one of them.

### Fixed

- **The map filter drop-down no longer freezes at whatever the first launch
  found.** It was filled once when the window opened, so on a fresh install —
  when the server list is still empty — it stayed empty for the whole session.
  It now refills as servers are discovered.

## v1.3.1 — 2026-08-05

### Fixed

- **Many modded servers showed a "?" for their mod count, and couldn't be
  joined because the launcher "could not read the mod list".** Three separate
  causes, fixed together:

  - The parser refused any server that advertises the Frostline DLC — a large
    and growing share of modded servers — because a DLC block sits ahead of
    its mod list. It now reads past that block and gets the mods.
  - A refresh only fetched mod lists for servers whose A2S keyword string
    contained the word "mod", which many DayZ servers never provide (their
    keyword field is junk). It now probes every server that answers.
  - A mod list larger than 4 KB was silently truncated by the network read,
    losing its tail and failing the parse. The receive buffer now fits the
    largest possible response.

- **The REFRESH button only re-probed the rows currently on screen**, leaving
  the rest of the list with stale data and stale "?" counts. It now re-probes
  the whole list you are looking at.

### Added

- **A HIDE OFFLINE button**, next to HIDE EMPTY, that drops the servers the
  last refresh couldn't reach — cleaning up the "?" clutter from rows that are
  simply offline.

## v1.3.0 — 2026-08-03

### Changed

- **The launcher keeps everything in one folder now, and it moves on first
  launch.** Your favourites, server list, settings and window position used to
  live in `%APPDATA%\com.tetra.launcher` — a folder nobody found without being
  told. They now live in `%LOCALAPPDATA%\com.tetra.launcher`, and the first
  time you run this version they are moved there for you. Nothing is lost; the
  move copies before it deletes, and if a copy fails the originals stay exactly
  where they were.

  Local rather than Roaming because the server list reaches 20 MB in ordinary
  use, and a roaming Windows profile copies its whole contents every time you
  sign in.

- **The join button says JOIN.** When you already have every mod a server
  needs, that is what the button now reads. It used to say VERIFY & JOIN, or
  just VERIFY if you had auto-join turned off, which described the launcher's
  housekeeping rather than what you were asking for. The check still runs on
  every press — the line under the button explains it — it simply is not the
  button's job to announce it.

  The two download labels are unchanged, because those describe work you can
  already see in the mod list.

### Added

- **Portable copies keep their data beside the exe.** Unzip the portable build
  and it stores `tetra.db` and `settings.json` in its own folder, so the whole
  thing travels on a USB stick. This is switched on by the `portable.txt` file
  in the zip — delete that file and the copy behaves like an installed one. A
  portable copy never touches an installed copy's data.

  If the folder it is unzipped into cannot be written to, it quietly falls back
  to per-user app data rather than failing to start.

- **A Data folder row in Settings → Launcher**, showing exactly where this copy
  keeps its files, with a button to open it.

- **The button says PLAYING while DayZ is running**, and it says so on every
  server, not just the one you launched from. The launcher asks Windows whether
  the game is running rather than counting down from a timer, so it is also
  right for a session you started from Steam.

### Fixed

- **The join button forgot what it was doing when you clicked another server.**
  Part-way through a download, selecting a different row silently abandoned the
  wait — Steam carried on downloading and the launcher stopped showing it. A
  download, verification or launch now stays on screen whichever server you are
  looking at, captioned with the server it belongs to.

- **The launcher joined, or refused to join, without saying which.** Every step
  of a join showed the same spinner, so a refused launch looked like the button
  simply bouncing back to normal. Verifying, subscribing, downloading,
  launching and starting are now distinct, and a refused launch shows the
  reason in a block you cannot miss instead of one small red line.

- **"Auto-join after downloading" fired at random.** With it off, a server you
  had every mod for would still say VERIFY & JOIN — and if the check then found
  a mod the Workshop had quietly updated, the launcher downloaded it and
  stopped, having promised a join. It now says JOIN throughout, and in that one
  case tells you the mods were updated and to press again.

- **A window quit while maximised came back the wrong size.** Restoring the
  maximised state ran before the interface scale was applied, and applying the
  scale resets the minimum window size, which Windows treats as a reason to
  un-maximise. The window came back at the right size with the maximised flag
  lost, and the next quit recorded your screen's dimensions as the size you had
  chosen.

## v1.2.0 — 2026-08-03

### Fixed

- **Changing any setting shunted a maximised window down and to the right.**
  Introduced in v1.1.0 by the interface-scale work: the launcher re-applied the
  scale on every settings write, and re-applying it re-set the minimum window
  size, which Windows treats as a reason to drop a maximised window back to a
  restored one. The scale is now applied only when it actually changes.

- **The horizontal scrollbar under the server list had no height**, so once the
  window was narrow enough for the columns to overflow there was content you
  could not reach and a scrollbar you could not grab. Styling the scrollbar at
  all opts out of the platform default for *both* axes, and only the vertical
  one had ever been given a size. It is now visible and deliberately a little
  thicker than the vertical bar, since it sits on the window's bottom edge where
  there is no room to overshoot.

  The wheel reaches sideways too: **Shift + wheel** anywhere over the table, or
  a plain wheel over the column headers.

- **The details panel went stale.** Ping, players, mods and the rest were a
  snapshot taken when you clicked the row, so REFRESH updated the table while
  the panel beside it kept showing the old numbers — the only way to see current
  values was to click away and back. It now follows the row it is showing.

- **The join button ignored "auto-join after downloading".** It read
  "SUBSCRIBE & JOIN" whether or not the setting would actually let it join.

- **The join button did not notice that downloading had started.** It stayed on
  "SUBSCRIBE & JOIN" while Steam downloaded — describing work already done —
  because one flag covered both "not subscribed" and "downloading". It now says
  which half of the job is left: SUBSCRIBE & JOIN, DOWNLOAD & JOIN, or
  VERIFY & JOIN, and drops the "& JOIN" when auto-join is off.

### Added

- **A refresh button on every row**, after the ping, for re-probing one server
  without re-probing everything on screen.

### Changed

- **Servers that have never answered a probe are now always hidden**, and the
  checkbox is gone. A row with no name, no player count and no map has nothing
  a player could choose it by — about 3,000 of a 10,500-row list. It was a
  setting only because it started life next to one that genuinely is a matter
  of taste.

- **"Subscribe all" is gone.** VERIFY & JOIN already subscribes to whatever is
  missing, waits for it and then launches, so the separate button was a slower
  route to the same place. **Unsubscribe** has moved below the join button,
  where a destructive, once-in-a-while action belongs.

## v1.1.0 — 2026-08-02

### Fixed

- **A server could refuse your connection for outdated mods the launcher had
  just called ready.** Everything showed installed and current, DayZ started,
  and the server rejected it over an out-of-date mod list — and hitting REFRESH
  did not help.

  The reason is that "needs an update" was never a fact about the Workshop. It
  is what the *Steam client last noticed*, and the client only notices when
  something asks. Until then a mod that was updated an hour ago still reports as
  current, and every check in the launcher believed it.

  JOIN SERVER is now **VERIFY & JOIN**, and it asks rather than believes:

  1. re-reads the server's mod list live, so a mod the server added since your
     last refresh cannot be missed, and updates the details panel with it;
  2. asks the Workshop directly for the version of every mod, with Steam's
     cache explicitly bypassed — the cache is what produced the wrong answer in
     the first place, so consulting it would only confirm the mistake;
  3. compares that against the copy on disk and starts a download for anything
     that has moved on;
  4. waits for those downloads, then launches.

  Servers running 90+ mods are queried in pages, because Steam answers 50 at a
  time. If Steam cannot be reached the join still proceeds — the pre-launch gate
  is unchanged and still has the final say on whether DayZ starts.

- **The CANCEL button was pushed off the edge of the panel** while mods were
  downloading, once the status line beside it grew long enough.

- **VERIFY & JOIN failed with "invalid socket address syntax"** on every server.
  The address the panel holds already carries the query port, and the new
  verification step appended it a second time.

- **The version check was skipped for anyone who joined shortly after opening
  the launcher** — which is most people. The Steam connection handles one
  request at a time, and a server discovery holds it for as long as it runs, so
  the check queued behind it and eventually gave up. It now completes alongside
  a discovery instead of waiting for one: measured at 0.7 seconds against a
  93-mod server with a discovery still streaming.

- **Problems below the JOIN button are now a short coded line** — `W01 Mod
  versions not checked` — instead of a paragraph that moved the button and got
  skipped anyway. Hovering gives the full explanation, and the code is
  something you can quote in a bug report. `W` means the join went ahead with
  something left undone; `E` means it stopped.

- **The button no longer runs its own text off the edge** while it works.
  "Checking the server's mod list…" became `VERIFYING…`.

### Added

- **An interface scale slider**, in the status bar, from 100% to 150%. The
  default is now **125%** rather than 100%, for everyone — the 10 and 11 pixel
  labels the launcher was built with were too small to read comfortably, which
  is a defect rather than a preference anyone chose. Expect fewer rows on screen
  and legible ones.

  The smallest permitted window grows with the setting, so the layout always has
  the room it was designed for. It replaces the "Verify = Steam reports
  installed & current" line, which has moved onto the VERIFY & JOIN button it
  describes.

- **Only one launcher can run at a time.** Opening a second copy now brings the
  first one back to the front instead of starting a rival that fights it over
  the same database, settings file and Steam session.

### Changed

- **Minimising can now go to the system tray too**, alongside closing. Settings
  → Launcher has a switch for each: *Minimise to the system tray* (off) and
  *Close to the system tray* (on, as before).

  They are separate because they are separate buttons. Wanting the launcher out
  of the taskbar while you play says nothing about whether closing it should
  quit, and the tray icon restores it either way.

  If you had close-to-tray switched off, you keep quitting on close.

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
