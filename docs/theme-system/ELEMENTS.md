# Theme system v2: element registry

This file lists every piece of core content a v2 theme can place, and the rules the validator enforces for each. It is the readable form of `src/theme/registry.json` (ADR-0007). The two must agree, and a test fails the build if they don't. Terms follow `CONTEXT.md`; the rules behind each column are specified in `SPEC.md`.

Every entry below is introduced in theme API 2.0 (`since: "2.0"`) and has no aliases yet.

## How to read the tables

| Column | Meaning |
|---|---|
| **Id** | The stable element id. Layout files place it as `{"element": "server.join"}`; CSS targets it as `[data-el="server.join"]`. |
| **Kind** | One of:<br>- `display`: read-only<br>- `input`: a control that holds state<br>- `action`: a button<br>- `nav`: moves between views<br>- `notice`<br>- `list`<br>- `block`: a launcher-owned block, placed whole (ADR-0024) |
| **Where** | Where it may be placed; codes are defined below. Placing it anywhere else is an import error. |
| **Req** | Where it is required; codes are defined below. `—` means optional everywhere. |
| **×** | How many times it may appear:<br>- `n`: any number of times<br>- `1`: once per composition<br>- `1/ctx`: once per subject context |
| **Options** | Typed options, written `name: value / value (default)`. |
| **Parts** | Named parts that CSS can target with `[data-part="…"]` inside the element's selector. |
| **States** | Values published in the element's `data-state`, for CSS `[data-state~="…"]`. |

### Compositions and multiplicity

Multiplicity is checked over a **composition**. A composition is:
- the shell together with one view,
- the shell together with Settings, in whichever presentation the theme picked,
- a modal file,
- a popup file.

The rules:
- `display` elements repeat freely.
- `input`, `nav`, `notice`, `list` and screen-level `action` elements appear at most once per composition. This way a control never fights a copy of itself over focus, and a notice is announced once.
- An action on a subject (a server or a mod) appears at most once per subject context. A server row, the server info modal and each selection panel can each hold one `server.join`.

### Where codes

| Code | Allowed files and positions |
|---|---|
| `app` | `layout/shell.json`, any view file, or `layout/settings.json` |
| `browser` | `layout/views/browser.json` |
| `mods` | `layout/views/mods.json` |
| `settings` | `layout/settings.json` |
| `server` | Anywhere a server is the subject: a `list.servers` row, `layout/modals/serverInfo.json`, a container with `"context": "selection"`, or `popup.serverActions` |
| `server-panel` | Same as `server`, minus rows: the server info modal, `selection` containers, `popup.serverActions` |
| `mod` | A `list.mods` row, or a container with `"context": "modSelection"` in `layout/views/mods.json` |
| `mod-panel` | A container with `"context": "modSelection"`, not a row |
| `serverMod` | A `list.serverMods` row |
| `modServer` | A `list.modServers` row |
| `workshopMod` | A `list.modFilterResults` row, or a container with `"context": "modFilterPreview"` in `layout/modals/modFilter.json` |
| `modFilter` | `layout/modals/modFilter.json` |
| `update` | `layout/modals/update.json` |
| `modal` | Any themeable modal file |
| `popup:<id>` | That popup's file, `layout/popups/<id>.json` |

### Req codes

| Code | Required in |
|---|---|
| `views` | Every composition of the shell with the server browser, and of the shell with Mods |
| `views+settings` | As `views`, plus the composition of the shell with Settings |
| `browser` / `mods` / `settings` | That composition only |
| `row` | Every row template of the named list |
| `modal` | The named modal file |
| `popup` | The named popup file |
| `with join` | Every subject context that places `server.join` |

A required element doesn't need to sit in the file its requirement names, as long as it's present in the composition. For example, window controls placed in each view file instead of the shell still count.

### Prefixes

| Prefix | Covers |
|---|---|
| `app.` | The window and shell |
| `nav.` | Moving between views, and opening Settings |
| `status.` | Read-only launcher status |
| `notice.` | Launcher messages |
| `filter.` | Server browser filters and sorting |
| `servers.` | Server browser actions not tied to one server |
| `server.` | One server |
| `serverMod.` | One entry in a server's required mods |
| `mods.` | Mods view actions not tied to one mod |
| `mod.` | One subscribed mod |
| `modServer.` | One server that needs a mod |
| `modFilter.` | The mod filter modal |
| `workshopMod.` | One mod inside the mod filter modal |
| `update.` | The update modal |
| `modal.` | Any themeable modal |
| `popup.` | The contents of themeable popups |
| `settings.` | Settings |
| `list.` | Lists |
| `surface.` | Surfaces |

A singular prefix (`server.`) acts on one subject; a plural prefix (`servers.`) acts on a whole view.

### Labels, wording and icons

- **Free labels:** an optional element with a `label` part accepts the `label` option. It is plain text of at most 40 characters and becomes both the visible and the accessible name. Required elements never accept `label`.
- **Wording variants:** some required elements offer `wording` variants instead of a free label, and the launcher picks the exact words for the current state.
- **Icons:** an element with an `icon` part accepts the `icon` option in one of three forms:
  - a launcher icon name from the allowlist in SPEC §6.5;
  - a package image path (`images/…`, SVG or PNG), rendered as a decorative `<img alt="">`;
  - `"none"`, allowed only when the element still renders a label.
- **`display` options:** these choose between `iconLabel`, `label` and `icon`. With `icon`, the launcher's wording remains the accessible name and the tooltip.

## app: window and shell

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `app.minimize` | action | app | views+settings | 1 | `icon` | icon | — |
| `app.maximize` | action | app | views+settings | 1 | `icon` | icon | `maximized` |
| `app.close` | action | app | views+settings | 1 | `icon` | icon | — |
| `app.dragRegion` | display | app | views+settings (at least one) | n | — | — | — |
| `app.logo` | display | app | — | n | `wordmark: true / false (true)` | image, wordmark | — |
| `app.collapseToggle` | action | app | — | 1 per target region | `region: region id` (required option), `label` (default "sidebar"), `icon` | icon | `collapsed` |
| `app.uiScale` | input | app | — | 1 | `showLabel: true / false (true)`, `showValue: true / false (true)`, `label` | label, track, knob, value | — |
| `app.schemeToggle` | action | app | — | 1 | `icon` | icon | `dark`, `light` |

- **`app.dragRegion`:** fills whatever size layout gives it, and dragging it moves the window. It never contains other nodes.
- **`app.collapseToggle`:** collapses and expands the named region. Its accessible name is "Collapse {label}" or "Expand {label}", and it carries `aria-expanded` and `aria-controls`.
- **Not placeable:** the window's resize edges are always present and launcher-owned.

## nav: views and Settings

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `nav.servers` | nav | app | views | 1 | `display: iconLabel / label / icon (iconLabel)`, `icon` | icon, label | `current` |
| `nav.favourites` | nav | app | views | 1 | as `nav.servers` | icon, label | `current` |
| `nav.recent` | nav | app | views | 1 | as `nav.servers` | icon, label | `current` |
| `nav.mods` | nav | app | views | 1 | as `nav.servers` | icon, label | `current` |
| `nav.settings` | nav | app | views | 1 | as `nav.servers` | icon, label | `open` |

- **Labels and icons:** Servers (Globe), Favourites (Star), Recent (Clock), Mods (Package), Settings (Settings gear).
- **The current nav item:** `current` sets `aria-current="page"`.
- **Opening Settings:** `nav.settings` toggles Settings and sets `aria-pressed`.
- **Keyboard:** inside a container with `"landmark": "navigation"`, nav items rove with the arrow keys and Home/End (SPEC §8.4).

## status: launcher status

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `status.steam` | display | app | views | n | `display: dotLabel / dot / label (dotLabel)` | dot, label | `connected`, `disconnected` |
| `status.serverTotal` | display | app | — | n | `showLabel: true / false (true)` | value, label | — |
| `status.populated` | display | app | — | n | `showLabel: true / false (true)` | value, label | — |
| `status.listSource` | display | app | — | n | — | label | `index`, `steam` |
| `status.lastRefreshed` | display | app | — | n | — | label, value | — |

- **`status.steam`:** reads "Steam connected" or "Steam not connected". With `display: dot`, that text becomes the accessible name and the tooltip.
- **`status.serverTotal`, `status.populated`, `status.listSource` and `status.lastRefreshed`:**
  - all four render nothing while Steam is disconnected;
  - `status.listSource` also renders nothing until the list source is known;
  - `status.lastRefreshed` also renders nothing before the first refresh.
- **Wording and tooltips:** unchanged from today.

## notice: launcher messages

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `notice.update` | notice | app | — | 1 | — | title, message, update, later | — |
| `notice.storage` | notice | app | views+settings | 1 | — | tag, message | — |
| `notice.error` | notice | app | views+settings | 1 | — | tag, message, dismiss | — |
| `notice.modsError` | notice | mods | mods | 1 | — | message | — |
| `notice.modsCached` | notice | mods | mods | 1 | — | message | — |
| `notice.modsResult` | notice | mods | mods | 1 | — | message, dismiss | `success`, `failure` |
| `notice.modsOutdated` | notice | mods | — | 1 | — | message, updateAll | `busy` |

A notice renders only while its condition holds. The visibility check measures it only while it is showing.

- **`notice.update`:**
  - "Update" opens the update modal; "Later" dismisses the notice for the session;
  - it is optional, because the update modal and Settings also offer updates.
- **`notice.modsResult`:** carries the outcome of verify, unsubscribe, clean-up and select-unique.
- **Launcher-owned notices:** these are not in the registry. The theme-fallback notice, the incompatible-theme notice and the Activation Safety Window are launcher-owned (SPEC §16).

## filter: server browser filters and sorting

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `filter.search` | input | browser | browser | 1 | `showIcon: true / false (true)` | icon, input | `filled` |
| `filter.map` | input | browser | — | 1 | `showLabel: true / false (true)`, `label` | label, value, chevron | `active`, `open` |
| `filter.tags` | input | browser | — | 1 | as `filter.map` | label, value, chevron | `active`, `open` |
| `filter.region` | input | browser | — | 1 | as `filter.map` | label, value, chevron | `active`, `open` |
| `filter.mods` | action | browser | — | 1 | as `filter.map` | label, value, chevron | `active` |
| `filter.sort` | input | browser | — | 1 | as `filter.map` | label, value, direction, chevron | `active`, `open` |
| `filter.maxPing` | input | browser | — | 1 | `showLabel: true / false (true)`, `showValue: true / false (true)`, `label` | label, track, knob, value | `active` |
| `filter.hideEmpty` | input | browser | — | 1 | `control: button / checkbox / switch (button)`, `label`, `icon` | label, box, icon | `on` |
| `filter.hideFull` | input | browser | — | 1 | as `filter.hideEmpty` | label, box, icon | `on` |
| `filter.hideLocked` | input | browser | — | 1 | as `filter.hideEmpty` | label, box, icon | `on` |
| `filter.hideOffline` | input | browser | — | 1 | as `filter.hideEmpty` | label, box, icon | `on` |
| `filter.reset` | action | browser | — | 1 | `display: iconLabel / label / icon (iconLabel)`, `icon`, `label` | icon, label | — |

- **`filter.search`:** writes the search filter after a 250 ms trailing debounce. Its placeholder is "Search servers…".
- **Popup triggers:** `filter.map`, `filter.tags`, `filter.region` and `filter.sort` open `popup.mapFilter`, `popup.tagsFilter`, `popup.regionFilter` and `popup.sort`, with `aria-haspopup="listbox"` and `aria-expanded`.
- **`filter.mods`:** opens the mod filter modal.
- **Label and value wording:** labels are MAP, TAGS, REGION, MODS, SORT and PING. Values:

  | Element | Value |
  |---|---|
  | Map | "Any", the map name, or "{n} maps" |
  | Tags | "Any" or "{n} tag(s)" |
  | Mods | "Any", "{n} mod(s)", "{n} excluded", or "{i} in, {e} out" |
  | Region | "Any", the region, or "{n} regions" |
  | Sort | "{key}" followed by the direction arrow |
  | Ping | "{v}ms" or "Any" |

- **`active` state:** map, tags, region and mods are `active` while they filter anything. Sort is `active` unless it is Players, descending. Ping is `active` below 500.
- **Hide toggles:** labelled "Hide empty", "Hide full", "Hide locked" and "Hide offline".
  - Default off, persisted, and cleared by `filter.reset` along with every other filter.
  - The control role follows the `control` option: `button` is a pressable button with `aria-pressed`; `checkbox` has `role="checkbox"`; `switch` has `role="switch"`.
  - The `box` part renders only for `checkbox` and `switch`.
- **Sort keys:** listed in SPEC §7.4.

## servers: server browser actions

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `servers.refresh` | action | browser | browser | 1 | `display: iconLabel / label / icon (iconLabel)`, `icon` | icon, label | `busy` |

`servers.refresh` re-probes the servers currently on screen. It reads "Refresh", or "Refreshing…" while `busy`, when it is disabled and its icon spins.

## server: one server

### Actions

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `server.join` | action | server | row of `list.servers`; modal `serverInfo` | 1/ctx | `wording: join / fixAndJoin (join)`, `display: iconLabel / label / icon (iconLabel)`, `icon` | icon, label, spinner | `busy`, `disabled`, `playing`, `modded`, `needsMods` |
| `server.actionNotice` | notice | server | with join | 1/ctx | — | message | `warning`, `error`, `success` |
| `server.cancel` | action | server | — | 1/ctx | `display: iconLabel / label / icon (label)`, `icon`, `label` | icon, label | — |
| `server.loadToMenu` | action | server | — | 1/ctx | `display: iconLabel / label / icon (iconLabel)`, `icon`, `label` | icon, label | `disabled`, `busy` |
| `server.info` | action | server, not the server info modal | — | 1/ctx | as `server.loadToMenu` | icon, label | — |
| `server.menu` | action | server, not a popup | — | 1/ctx | `menu: serverActions / serverLoad (serverActions)`, `icon`, `label` | icon | `open` |
| `server.favourite` | action | server | — | 1/ctx | `display: icon / iconLabel (icon)`, `icon`, `label` | icon, label | `on` |
| `server.subscribeAll` | action | server | — | 1/ctx | as `server.loadToMenu` | icon, label | `disabled`, `busy` |
| `server.checkMods` | action | server | — | 1/ctx | as `server.loadToMenu` | icon, label | `busy` |
| `server.unsubscribeUnique` | action | server | — | 1/ctx | as `server.loadToMenu` | icon, label | `disabled`, `busy` |
| `server.copyAddress` | action | server | — | 1/ctx | as `server.loadToMenu` | icon, label | `copied` |
| `server.deselect` | action | `selection` containers | — | 1/ctx | `icon`, `label` | icon | — |

- **`server.join`:** runs today's join, which verifies and fixes mods first.
  - **Wording:**

    | State | Wording |
    |---|---|
    | Idle | "Join", or "Fix and join" when the variant is `fixAndJoin` and mods need a download or update |
    | `busy` | The phase label: "Launching…", "Starting DayZ…", "Subscribing…", "Downloading…" or "Verifying…" |
    | `playing` | "Playing" |

  - **Disabled:** during any operation, or while DayZ is running. The tooltip reads "DayZ is running. Quit the game before joining another server."
  - **Icon:** Download for modded servers, Play otherwise.
  - **Selection:** clicking Join never selects its row.
- **`server.actionNotice`:** shows this server's current join warning or error (W01–W04, E01) or the last launch result. It is placed automatically right after `server.join` wherever a theme omits it (SPEC §6.8).
- **`server.cancel`:** renders only while this server has a wait that can be cancelled.
- **`server.loadToMenu`:** reads "Load to menu" and verifies the mod list, then starts DayZ at the main menu without joining. It is disabled under the same conditions as Join.
- **`server.info`:** reads "More info" and opens the server info modal.
- **`server.menu`:** opens `popup.serverActions` or `popup.serverLoad`, with `aria-haspopup="menu"`. Its accessible name is "More actions for {server}".
- **`server.favourite`:** reads "Add to favourites" or "Remove from favourites". The change is applied optimistically and reverted if saving fails.
- **`server.subscribeAll`:** reads "Download mods" and subscribes to every mod the server declares.
- **`server.checkMods`:** reads "Check mods". It re-reads the server's mod list and each mod's state, and never queues a download (SPEC §11.3).
- **`server.unsubscribeUnique`:** reads "Unsubscribe unique mods". It opens the launcher's confirmation (ADR-0020, ADR-0024), and is disabled when no mod is unique to this server.
- **`server.copyAddress`:** reads "Copy address", or "Copied" for 1.5 s after copying `ip:gamePort`.
- **`server.deselect`:** reads "Close details" and clears the selection.

### Display

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `server.name` | display | server | — | n | — | text | — |
| `server.address` | display | server | — | n | `showGamePort: true / false (false)` | address, gamePort | — |
| `server.map` | display | server | — | n | — | text | — |
| `server.region` | display | server | — | n | `format: name / code (name)` | text | `unknown` |
| `server.gameTime` | display | server | — | n | `showIcon: true / false (true)`, `showMultiplier: true / false (true)` | icon, time, multiplier | `day`, `night`, `unknown` |
| `server.players` | display | server | — | n | `format: countMax / count (countMax)`, `showQueue: true / false (true)`, `showCaption: true / false (true)` | value, max, queue, caption | `empty`, `full`, `queued`, `offline` |
| `server.ping` | display | server | — | n | `showUnit: true / false (false)`, `showCaption: true / false (true)` | value, unit, caption | `good`, `fair`, `poor`, `unknown`, `offline` |
| `server.modCount` | display | server | — | n | `showCaption: true / false (true)` | value, caption | `none`, `unprobed` |
| `server.version` | display | server | — | n | — | text | `unknown` |
| `server.lastPlayed` | display | server | — | n | `format: relative / date (relative)`, `recentOnly: true / false (false)` | label, value | — |
| `server.tags` | display | server | — | n | `officialWording: vanilla / official (vanilla)`, and booleans `showOffline`, `showOfficial`, `showModded`, `showFirstPerson`, `showLocked`, `showModUpdate` (true) and `showBattleye` (false) | chip | per chip: `offline`, `official`, `modded`, `firstPerson`, `locked`, `battleye`, `modUpdate` |
| `server.modUpdate` | display | server | — | n | — | label | — |
| `server.readiness` | display | server-panel | — | n | `showDot: true / false (true)`, `showSize: true / false (true)` | dot, label, size | `checking`, `ready`, `needsDownload`, `needsUpdate`, `downloading`, `unchecked`, `noMods`, `stale` |
| `server.downloadSize` | display | server-panel | — | n | — | qualifier, value | `upperBound`, `none`, `checking` |

- **Formats:**

  | Element | Format |
  |---|---|
  | `server.gameTime` | "h:mm AM/PM · {multiplier}"; "--:--" when unknown |
  | `server.players` | "{players}/{max}", with "+{queue}" when queued |
  | `server.ping` | A number, or "—"; `good` ≤ 80, `fair` ≤ 120, `poor` above 120 |
  | `server.modCount` | The count, "—" for none, or "?" when modded but not yet probed |
  | `server.lastPlayed` | "played {relative time}" or a date; renders nothing when the server was never played. With `recentOnly`, it also renders nothing outside the Recent scope |
  | `server.region` | Europe, North America, South America, Asia, Oceania, the raw code if unmapped, or "Unknown region" |

- **`server.tags`:** renders chips in the order offline, official (VANILLA or OFFICIAL), modded, first person (1PP), locked, BattlEye, mod update.
- **`server.modUpdate`:** renders "UPDATE" only while a declared mod has a pending Steam update.
- **Readiness data:** `server.readiness` and `server.downloadSize` read the data fetched for the selection and the server info modal (SPEC §11.2). They are not allowed in rows, where fetching per visible row would flood Steam. Wording and size rules are in SPEC §11.2.
- **Offline servers:** `offline` is added to every server element's states while the server didn't answer the last refresh. Its figures are then the last known values.

## serverMod: a server's required mods

These elements are placed in the row template of `list.serverMods`. Rows keep the server's declared order.

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `serverMod.order` | display | serverMod | — | n | — | value | — |
| `serverMod.thumbnail` | display | serverMod | — | n | — | image | `missing` |
| `serverMod.name` | display | serverMod | — | n | — | text | — |
| `serverMod.state` | display | serverMod | — | n | `display: dotLabel / dot / label (dotLabel)` | dot, label | `checking`, `ready`, `needsUpdate`, `downloading`, `notInstalled`, `notSubscribed`, `serverSide` |
| `serverMod.size` | display | serverMod | — | n | — | qualifier, value | `upperBound`, `unknown` |
| `serverMod.progress` | display | serverMod | — | n | — | bar, value | `indeterminate` |
| `serverMod.unique` | display | serverMod | — | n | — | label | — |
| `serverMod.openInSteam` | action | serverMod | — | 1/ctx | `display: iconLabel / label / icon (icon)`, `icon`, `label` | icon, label | `disabled` |

- **`serverMod.state` wording:**

  | State | Wording |
  |---|---|
  | `ready` | "Ready" |
  | `needsUpdate` | "Needs update" |
  | `downloading` | "Downloading" |
  | `notInstalled` | "Not installed" |
  | `notSubscribed` | "Not subscribed" |
  | `serverSide` | "Server-side" |
  | `checking` | "Checking…" |

- **`serverMod.size`:**
  - shows the full size for `notSubscribed` and `notInstalled`;
  - shows "up to {size}" for `needsUpdate` (ADR-0021);
  - is empty for `ready` and `serverSide`.
- **`serverMod.progress`:** renders only while downloading, and is `indeterminate` until Steam reports a total.
- **`serverMod.unique`:** reads "Only this server" when no other cared-about server needs the mod.
- **`serverMod.openInSteam`:** is disabled for server-side mods, which have no Workshop page.

## mods: Mods view actions

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `mods.search` | input | mods | — | 1 | `showIcon: true / false (false)` | icon, input | `filled` |
| `mods.statusFilter` | input | mods | — | 1 | — | option | per option: `selected` |
| `mods.refresh` | action | mods | — | 1 | `display: iconLabel / label / icon (iconLabel)`, `icon`, `label` | icon, label | `busy` |
| `mods.count` | display | mods | — | n | — | value, label | `selecting` |
| `mods.selectAll` | action | mods | — | 1 | as `mods.refresh` | icon, label | `disabled` |
| `mods.clearSelection` | action | mods | — | 1 | as `mods.refresh` | icon, label | — |
| `mods.selectUnique` | input | mods | — | 1 | `label` | label, value, chevron | `open`, `disabled` |
| `mods.cleanupRemoved` | action | mods | — | 1 | as `mods.refresh` | icon, label | `disabled` |
| `mods.unsubscribe` | action | mods | — | 1 | as `mods.refresh` | icon, label | `busy`, `disabled` |
| `mods.unsubscribeMenu` | action | mods | — | 1 | `icon` | icon | `open` |
| `mods.unsubscribeSelected` | action | mods, popup:modsUnsubscribe | — | 1 | `label` | label | `disabled` |
| `mods.unsubscribeAll` | action | mods, popup:modsUnsubscribe | — | 1 | `label` | label | `disabled` |
| `mods.updateOutdated` | action | mods | — | 1 | as `mods.refresh` | icon, label | `disabled` |
| `mods.verify` | action | mods | — | 1 | as `mods.refresh` | icon, label | `busy` |
| `mods.verifyMenu` | action | mods | — | 1 | `icon` | icon | `open` |
| `mods.verifySelected` | action | mods, popup:modsVerify | — | 1 | `label` | label | `disabled` |
| `mods.verifyAll` | action | mods, popup:modsVerify | — | 1 | `label` | label | — |

- **`mods.search`:** matches title, tags or Workshop id, with no debounce. Its placeholder is "Search mods by name, tag or id…".
- **`mods.statusFilter`:** offers All, Outdated and Downloading as a single-choice group (`role="radiogroup"`).
- **`mods.refresh`:** re-reads the mod list and refreshes Workshop details.
- **`mods.count`:** reads "{s} of {n} selected" while anything is selected, otherwise "{n} mod(s)".
- **`mods.selectAll` and `mods.clearSelection`:** read "Select all" and "Clear". They render only when they would change the checked set.
- **`mods.selectUnique`:**
  - reads "Select unique…", or "Unique: {server}" with the name truncated to 24 characters;
  - opens `popup.modsUnique`;
  - is disabled when there are no cared-about servers.
- **`mods.cleanupRemoved`:** reads "Clean up {n}" and renders only when removed mods exist.
- **`mods.unsubscribe`:** reads "Unsubscribe {n}", "Unsubscribe" or "Removing…". It acts on the checked mods and is disabled when none are checked.
- **Menus:** `mods.unsubscribeMenu` and `mods.verifyMenu` open `popup.modsUnsubscribe` and `popup.modsVerify`.
- **`mods.updateOutdated`:** reads "Update {n}" and renders only when mods are outdated.
- **`mods.verify`:** reads "Verify mods" or "Verifying…". It verifies every mod and re-downloads anything outdated.
- **Menu items:** "Unsubscribe selected ({n})", "Unsubscribe from all {n} (destructive)", "Verify selected ({n})" and "Verify all ({n})".
- **Confirmations:** every unsubscribe and clean-up action opens the launcher's confirmation dialog first (ADR-0024).

## mod: one subscribed mod

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `mod.select` | input | mod | row of `list.mods` | 1/ctx | — | box | `checked` |
| `mod.status` | display | mod | row of `list.mods` | n | — | label, progress | `ready`, `update`, `downloading`, `missing`, `notSubscribed`, `serverSide` |
| `mod.thumbnail` | display | mod | — | n | — | image, placeholder | `missing`, `disabled` |
| `mod.name` | display | mod | — | n | — | text | — |
| `mod.disabledBadge` | display | mod | — | n | — | label | — |
| `mod.tags` | display | mod | — | n | `limit: 3 / 6 / all (3)`, `style: text / chips (text)` | text, chip | — |
| `mod.size` | display | mod | — | n | — | value | `unknown` |
| `mod.updated` | display | mod | — | n | `format: relative / date (relative)` | value | `unknown` |
| `mod.subscribed` | display | mod | — | n | `format: relative / date (relative)` | value | `unknown` |
| `mod.rating` | display | mod | — | n | — | up, down | — |
| `mod.workshopId` | display | mod | — | n | — | text | — |
| `mod.description` | display | mod | — | n | `clamp: none / 3 / 6 (6)` | text | `empty` |
| `mod.neededBy` | display | mod-panel | — | n | — | value, label | — |
| `mod.update` | action | mod | — | 1/ctx | `display: iconLabel / label / icon (label)`, `icon`, `label` | icon, label | `busy` |
| `mod.openInSteam` | action | mod | — | 1/ctx | as `mod.update` | icon, label | — |
| `mod.openFolder` | action | mod | — | 1/ctx | as `mod.update` | icon, label | — |
| `mod.reinstall` | action | mod | — | 1/ctx | as `mod.update` | icon, label | `busy` |
| `mod.deselect` | action | mod-panel | — | 1/ctx | `icon`, `label` | icon | — |

- **Selection:**
  - `mod.select` checks the mod for bulk actions; it doesn't select it for detail panels. Its accessible name is "Select {title}".
  - Clicking elsewhere on a row selects the mod (SPEC §8.3).
- **`mod.status` wording:** "Ready", "Update", "Downloading", "Missing", "Not subscribed" or "Server-side". The `progress` part renders only while downloading with a known total, and the state follows a 1.5 s live poll.
- **`mod.thumbnail`:** shows the preview image. Without one, it shows "⏸" when the mod is locally disabled, otherwise "—".
- **`mod.disabledBadge`:** reads "Disabled" and renders only while the mod is locally disabled. `disabled` is also added to every mod element's states then.
- **Formats:**
  - `mod.tags` falls back to the Workshop id when the mod has no tags;
  - `mod.size` shows the size on disk to one decimal place;
  - `mod.rating` shows "{up}▲ / {down}▼".
- **`mod.neededBy`:** reads "Needed by {n} servers" for the selected mod, counting the entries of `list.modServers`.
- **Actions:**
  - `mod.update` reads "Update" and renders only while the mod needs an update;
  - `mod.openFolder` reads "Open folder" and renders only while the mod has a folder on disk;
  - `mod.reinstall` reads "Reinstall";
  - `mod.openInSteam` reads "Open in Steam".
- **`mod.deselect`:** reads "Close details" and clears the mod selection.

## modServer: servers that need a mod

These elements are placed in the row template of `list.modServers`. Entries are servers in the browser that declare the selected mod, most recently played first. They are not server entries for the Join rule (ADR-0010) and carry no actions.

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `modServer.name` | display | modServer | — | n | — | text | — |
| `modServer.address` | display | modServer | — | n | — | text | — |
| `modServer.lastPlayed` | display | modServer | — | n | `format: relative / date (relative)` | label, value | `never` |

## modal: any themeable modal

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `modal.close` | action | modal | modal (every themeable modal) | 1 | `icon` | icon | — |

`modal.close` closes the modal without applying anything. Its accessible name is "Close".

## modFilter: the mod filter modal

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `modFilter.apply` | action | modFilter | modal `modFilter` | 1 | — | label | — |
| `modFilter.source` | input | modFilter | — | 1 | — | tab | per tab: `selected` |
| `modFilter.search` | input | modFilter | — | 1 | `showIcon: true / false (false)` | icon, input | `filled`, `busy` |
| `modFilter.summary` | display | modFilter | — | n | `showThumbnails: true / false (true)` | thumbnails, more, counts | `empty` |
| `modFilter.clear` | action | modFilter | — | 1 | `label` | label | `disabled` |
| `modFilter.matchMode` | input | modFilter | — | 1 | — | option | per option: `selected` |
| `modFilter.cancel` | action | modFilter | — | 1 | `label` | label | — |

- **`modFilter.apply`:** reads "Apply". It writes the included mods, the excluded mods and the match mode to the server filter, then closes.
- **`modFilter.source`:** offers Subscribed, Seen on servers and Search Workshop as an ARIA tablist with arrow keys. Switching clears the preview.
- **`modFilter.search`:**
  - its placeholder follows the source: "Filter your subscribed mods…", "Filter mods seen on these servers…" or "Search the Workshop by name…";
  - it filters locally, except on Search Workshop, where it runs a 350 ms debounced search and is `busy` while searching.
- **`modFilter.summary`:** reads "Nothing selected", or shows up to 4 thumbnails, "+{n}", and "{n} included · {n} excluded".
- **`modFilter.clear`:** reads "Clear" and removes every pick.
- **`modFilter.matchMode`:** offers "Match any" and "Match all" as a radiogroup.
- **`modFilter.cancel`:** reads "Cancel" and closes without applying.
- **On open:** the picks are seeded from the current filter, and focus moves to `modFilter.search`, or to the first focusable element if the theme didn't place it.

## workshopMod: mods inside the mod filter modal

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `workshopMod.pick` | input | workshopMod | row of `list.modFilterResults` | 1/ctx | — | box | `included`, `excluded` |
| `workshopMod.thumbnail` | display | workshopMod | — | n | — | image, initials | `missing` |
| `workshopMod.name` | display | workshopMod | — | n | — | text | — |
| `workshopMod.subscribed` | display | workshopMod | — | n | `icon` | icon | — |
| `workshopMod.serverCount` | display | workshopMod | — | n | — | value, unit | `none` |
| `workshopMod.score` | display | workshopMod | — | n | — | value | — |
| `workshopMod.subscribers` | display | workshopMod | — | n | — | value, label | — |
| `workshopMod.size` | display | workshopMod | — | n | — | value | `unknown` |
| `workshopMod.updated` | display | workshopMod | — | n | `format: relative / date (relative)` | label, value | — |
| `workshopMod.description` | display | workshopMod | — | n | `clamp: none / 3 / 6 (none)` | text | `empty` |
| `workshopMod.tags` | display | workshopMod | — | n | `limit: 3 / 6 / all (all)` | chip | — |
| `workshopMod.serverNote` | display | workshopMod | — | n | — | text | — |
| `workshopMod.viewOnSteam` | action | workshopMod | — | 1/ctx | `label` | label, icon | — |
| `workshopMod.include` | action | workshopMod | — | 1/ctx | — | label | `on` |
| `workshopMod.exclude` | action | workshopMod | — | 1/ctx | — | label | `on` |

- **`workshopMod.pick`:** cycles from none to include (✓) to exclude (⊘) and back to none. Its accessible name follows the next step: "Include {t}", "Exclude {t} instead" or "Clear the {t} filter".
- **Previewing:** clicking a row, or pressing Enter or Space on it, previews that mod in `modFilterPreview` containers.
- **`workshopMod.subscribed`:** renders ★ only for subscribed mods.
- **Formats:**
  - `workshopMod.serverCount` shows "{n} srv" or "—";
  - `workshopMod.score` shows "{score}%";
  - `workshopMod.subscribers` shows "{n} subscribers";
  - `workshopMod.updated` shows "Updated {relative time}".
- **Include and exclude:** `workshopMod.include` reads "Include" or "Included"; `workshopMod.exclude` reads "Exclude" or "Excluded".
- **`workshopMod.viewOnSteam`:** reads "View on Steam" and opens the Workshop page.

## update: the update modal

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `update.install` | action | update | modal `update` | 1 | — | label | `busy`, `disabled` |
| `update.viewRelease` | action | update | modal `update` | 1 | — | label | — |
| `update.later` | action | update | — | 1 | — | label | `disabled` |
| `update.title` | display | update | — | n | — | text | — |
| `update.summary` | display | update | — | n | — | message, version, date | `available`, `upToDate` |
| `update.changelog` | display | update | — | n | — | content | `empty` |
| `update.progress` | display | update | — | n | — | label, bar, error | `downloading`, `failed` |
| `update.portableNote` | display | update | — | n | — | text | — |

- **Primary action:** `update.install` and `update.viewRelease` are both required, so the modal always has its primary action.
  - `update.install` reads "Update & Restart" and renders only for an installed copy.
  - `update.viewRelease` reads "View Release" and renders only for a portable copy.
- **`update.later`:** reads "Later", or "Updating…" while installing.
- **`update.title`:** reads "Update available" or "Updates".
- **`update.summary`:** reads "A newer version of Tetra Launcher is available." with "v{version}" and the date, or "You're up to date.".
- **`update.changelog`:** Markdown rendered by the launcher, with links opening externally.
- **`update.progress`:** reads "Downloading… {pct}%", and shows any error.

## settings: Settings

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `settings.back` | action | settings | settings | 1 | `display: iconLabel / label / icon (label)`, `icon` | icon, label | — |
| `settings.themeManagement` | block | settings | settings | 1 | — | — | — |
| `settings.profileName` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, control | — |
| `settings.dayzPath` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, control | — |
| `settings.detectPaths` | action | settings | settings | 1 | — | label | `busy` |
| `settings.workshopPath` | display | settings | settings | n | `showHint: true / false (true)` | label, hint, control | — |
| `settings.launchParams` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, control | — |
| `settings.minimiseToTray` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, box | `checked` |
| `settings.closeToTray` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, box | `checked` |
| `settings.onJoin` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, control | — |
| `settings.startWithWindows` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, box, note | `checked` |
| `settings.startMinimised` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, box | `checked`, `disabled` |
| `settings.discordPresence` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, box | `checked` |
| `settings.dataFolder` | display | settings | settings | n | `showHint: true / false (true)` | label, hint, control | — |
| `settings.openDataFolder` | action | settings | settings | 1 | — | label | `disabled` |
| `settings.autoRefresh` | input | settings | settings | 1 | `showHint: true / false (true)` | label, hint, control | — |
| `settings.title` | display | settings | — | n | — | text | — |
| `settings.sectionTitle` | display | settings | — | n | `section: game / launcher / theme` (required option) | text | — |
| `settings.sectionDescription` | display | settings | — | n | `section: game / launcher / theme` (required option) | text | — |
| `settings.sectionIcon` | display | settings | — | n | `section: game / launcher / theme` (required option) | icon | — |
| `settings.groupTitle` | display | settings | — | n | `group: window / startup / discord` (required option) | text | — |

- **Required controls:** every Settings control is required (Q24), and each saves as soon as it changes, as today.
  - They may sit in closed sections (ADR-0011).
  - Labels, hints, placeholders and choices are the launcher's current wording.
- **`settings.back`:** reads "Back" and closes Settings. When Settings is presented as a view, it returns to the previous view. Its accessible name is "Back to the launcher".
- **`settings.themeManagement`:** the launcher-owned theme management block (ADR-0024):
  - installed themes, Import, New theme and pagination;
  - the active theme strip, the token customiser (SPEC §4.6) and theme settings;
  - Dev Mode and Reset to Default.
- **`settings.detectPaths`:** reads "Detect", or "…" while `busy`, and fills in the Steam, DayZ and Workshop paths.
- **`settings.workshopPath` and `settings.dataFolder`:** read-only fields; the data folder shows "Locating…" until its path is known.
- **`settings.openDataFolder`:** reads "Open" and is disabled until the path is known.
- **`settings.startWithWindows`:** its `note` part is today's always-shown debug-build note.
- **`settings.startMinimised`:** disabled unless Start with Windows is on.
- **Section and group text:** the launcher's wording for section headers ("Game", "Launcher", "Theme" and their descriptions) and for checkbox group headings ("Window", "Startup", "Discord").

## list: the lists

Every list follows one model (ADR-0018): the theme declares the list's columns once, a launcher-rendered header shows them, and a row template places elements into those same columns. The file format is in SPEC §7.

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `list.servers` | list | browser | browser | 1 | `header: true / false (true)`, `rowGap: token (none)`, `estimatedRowHeight: length (56px)` | header, column, scroller, rows, empty, loading | `empty`, `loading`, `filtered` |
| `list.mods` | list | mods | mods | 1 | as `list.servers`, `estimatedRowHeight (54px)` | header, column, scroller, rows, empty, loading | `empty`, `loading`, `filtered` |
| `list.modFilterResults` | list | modFilter | modal `modFilter` | 1 | as `list.servers`, `estimatedRowHeight (44px)` | header, column, scroller, rows, empty, loading | `empty`, `loading`, `searching` |
| `list.serverMods` | list | server-panel | — | 1/ctx | `header: true / false (false)`, `rowGap`, `estimatedRowHeight (32px)` | header, column, scroller, rows, empty, loading | `empty`, `loading`, `stale` |
| `list.modServers` | list | mod-panel | — | 1/ctx | as `list.serverMods` | header, column, scroller, rows, empty, loading | `empty`, `loading` |

### Row subjects and templates

| List | Row subject | Row template file |
|---|---|---|
| `list.servers` | server | `layout/lists/servers.json` |
| `list.mods` | mod | `layout/lists/mods.json` |
| `list.modFilterResults` | workshopMod | `layout/lists/modFilterResults.json` |
| `list.serverMods` | serverMod | `layout/lists/serverMods.json` |
| `list.modServers` | modServer | `layout/lists/modServers.json` |

### Sort keys

A column may name a sort key only from its own list's set. Clicking that column's header sorts by it; clicking again reverses the direction.

| List | Sort keys | Default |
|---|---|---|
| `list.servers` | `players`, `ping`, `mods`, `name`, `map`, `lastPlayed` | `players`, descending |
| `list.mods` | `name`, `status`, `size`, `updated`, `subscribed` | `name`, ascending |
| `list.modFilterResults` | none: the source's own order | — |
| `list.serverMods` | none: the server's declared order | — |
| `list.modServers` | none: most recently played first | — |

- **`popup.sort`** offers the server keys Players, Ping, Mods, Name and Map, as today. `lastPlayed` is reachable only through a column header.
- **Mods sorting** is new launcher behaviour (ADR-0018): `status` is new, and the other four already exist in the store with nothing to reach them.

### Row states

Every row carries `data-state`, and rows are not focusable themselves; Tab moves into their elements (SPEC §8.4).

| List | Row states |
|---|---|
| `list.servers` | `selected`, `focused`, `offline`, `favourite`, `modded`, `official`, `firstPerson`, `locked`, `full`, `empty`, `modsPending`, `busy` |
| `list.mods` | `selected`, `focused`, `checked`, `disabled`, `ready`, `update`, `downloading`, `missing`, `notSubscribed`, `serverSide` |
| `list.modFilterResults` | `previewed`, `focused`, `included`, `excluded`, `subscribed` |
| `list.serverMods` | `ready`, `needsUpdate`, `downloading`, `notInstalled`, `notSubscribed`, `serverSide`, `unique` |
| `list.modServers` | `favourite`, `played` |

### Empty and loading text

The `empty` and `loading` parts carry the launcher's wording:

| List | Text |
|---|---|
| `list.servers` | "No servers match the current filters." after the first load; before it, "No servers yet — the list fills in once Steam connects." |
| `list.mods` | "Loading subscribed mods…", "No mods match the current filter.", or "You have no subscribed DayZ Workshop mods." |
| `list.modFilterResults` | "Loading…", "Type a mod name above to search the Workshop.", "No subscribed DayZ mods.", or "No mods match." |
| `list.serverMods` | "This server declares no mods." |
| `list.modServers` | "No servers in the browser need this mod." |

A theme may place its own theme text instead, by giving the list an `empty` subtree (SPEC §7.7).

## surface: ready-made groups

A surface is placed whole (ADR-0006). Its elements keep their own ids, states and parts, so CSS still reaches them; only its arrangement is fixed. Placing a surface satisfies the requirements of every required element inside it.

| Id | Where | Contains |
|---|---|---|
| `surface.windowControls` | app | `app.minimize`, `app.maximize`, `app.close` |
| `surface.navRail` | app | `app.logo`, the five `nav.*` elements, `app.collapseToggle` |
| `surface.filterBar` | browser | `filter.search`, `filter.map`, `filter.tags`, `filter.mods`, `filter.region`, `filter.sort`, `filter.maxPing`, the four hide toggles, `filter.reset`, `servers.refresh` |
| `surface.footerStatus` | app | `status.steam`, `status.serverTotal`, `status.populated`, `status.listSource`, `status.lastRefreshed`, `app.uiScale`, `app.schemeToggle` |
| `surface.serverIdentity` | server | `server.name`, `server.address`, `server.tags` |
| `surface.serverStats` | server | `server.players`, `server.ping`, `server.gameTime` |
| `surface.serverProps` | server | `server.map`, `server.version`, `server.region`, `server.modCount` |
| `surface.modDetails` | mod | `mod.subscribed`, `mod.updated`, `mod.size`, `mod.rating`, `mod.workshopId` |
| `surface.modsActionBar` | mods | `mods.count`, `mods.selectAll`, `mods.clearSelection`, `mods.selectUnique`, `mods.cleanupRemoved`, `mods.unsubscribe`, `mods.unsubscribeMenu`, `mods.updateOutdated`, `mods.verify`, `mods.verifyMenu` |
| `surface.updateBody` | update | `update.summary`, `update.changelog`, `update.progress`, `update.portableNote` |

A surface counts as one placement of each element inside it, so placing `surface.filterBar` and a separate `filter.search` in the same composition is a multiplicity error.

## modal: the themeable modals

| Modal | File | Subject | Required |
|---|---|---|---|
| Server info | `layout/modals/serverInfo.json` | server | `modal.close`, `server.join` (ADR-0010), `server.actionNotice` (auto-placed) |
| Mod filter | `layout/modals/modFilter.json` | — | `modal.close`, `modFilter.apply`, `list.modFilterResults` |
| Update | `layout/modals/update.json` | — | `modal.close`, `update.install`, `update.viewRelease` |

Launcher-owned dialogs are not themeable and take only colour and type tokens: every destructive confirmation, theme import and export, delete-theme, Steam required, and first-run setup.

## popup: the themeable popups

Each popup has its own file, `layout/popups/<id>.json`, declaring its placement mode and its contents (SPEC §9.6). A missing file means the launcher's default popup.

| Popup id | Opened by | Required contents |
|---|---|---|
| `mapFilter` | `filter.map` | `popup.mapOptions` |
| `tagsFilter` | `filter.tags` | `popup.tagOptions` |
| `regionFilter` | `filter.region` | `popup.regionOptions` |
| `sort` | `filter.sort` | `popup.sortOptions` |
| `serverActions` | `server.menu` | none: an action menu |
| `serverLoad` | `server.menu` with `menu: serverLoad` | none: an action menu |
| `modsUnsubscribe` | `mods.unsubscribeMenu` | none: an action menu |
| `modsVerify` | `mods.verifyMenu` | none: an action menu |
| `modsUnique` | `mods.selectUnique` | `popup.uniqueServerOptions` |

| Id | Kind | Where | Req | × | Options | Parts | States |
|---|---|---|---|---|---|---|---|
| `popup.mapOptions` | input | popup:mapFilter | popup | 1 | — | option, empty | per option: `selected` |
| `popup.tagOptions` | input | popup:tagsFilter | popup | 1 | — | option | per option: `included`, `excluded` |
| `popup.regionOptions` | input | popup:regionFilter | popup | 1 | — | option | per option: `selected` |
| `popup.regionNote` | display | popup:regionFilter | — | n | — | text | — |
| `popup.sortOptions` | input | popup:sort | popup | 1 | — | option | per option: `selected`, `ascending`, `descending` |
| `popup.uniqueServerOptions` | input | popup:modsUnique | popup | 1 | — | option, empty | — |
| `popup.clear` | action | popup:mapFilter, popup:tagsFilter, popup:regionFilter | — | 1 | `label` | label | `disabled` |
| `popup.close` | action | any popup | popups placed in a region or inline | 1 | `icon`, `label` | icon, label | — |

- **Option lists:** `popup.mapOptions`, `popup.regionOptions` and `popup.uniqueServerOptions` are single lists of `role="option"` entries with a check mark on the selected ones. `popup.tagOptions` cycles Official, Modded and First person through include (✓), exclude (✗) and off. `popup.sortOptions` lists the server sort keys.
- **Empty text:** "Loading maps..." for maps, and "No favourites or recently played servers yet." for unique servers.
- **`popup.regionNote`:** reads "Approximate — based on IP block, not confirmed location".
- **`popup.clear`:** reads "Clear" and resets that filter.
- **`popup.close`:** required only where a popup can't be dismissed by clicking outside an anchored panel, so a region or inline popup always has a way out.
- **Server actions in menus:** `popup.serverActions` and `popup.serverLoad` may hold any `server.*` action, and `server.actionNotice`. They read the server their trigger belongs to.

## Not placeable

These are launcher-owned and never appear in a layout file:

- the window's resize edges;
- the theme-fallback notice, the incompatible-theme notice and the Activation Safety Window;
- Steam required, first-run setup and the splash;
- the confirmation dialog, and the theme import, export and delete dialogs;
- everything inside `settings.themeManagement`.

## v1 to v2 id map

v1 packages are refused at import (ADR-0003), so this table is for porting the launcher's own JSX tags and the bundled themes, not for a compatibility layer. A v1 id is written `slot/child`.

| v1 | v2 |
|---|---|
| `shell.header/windowControls` | `app.minimize`, `app.maximize`, `app.close` |
| `shell.header/dragRegion` | `app.dragRegion` |
| `shell.sidebar/logo` | `app.logo` |
| `shell.sidebar/navList` | a container with `"landmark": "navigation"` |
| `shell.sidebar/navServers`, `navFavourites`, `navRecent`, `navMods` | `nav.servers`, `nav.favourites`, `nav.recent`, `nav.mods` |
| `shell.sidebar/settingsEntry` | `nav.settings` |
| `shell.sidebar/collapseToggle` | `app.collapseToggle` |
| `shell.footer/steamStateChip` | `status.steam` |
| `shell.footer/serverCounts` | `status.serverTotal`, `status.populated`, `status.listSource`, `status.lastRefreshed` |
| `shell.footer/uiScaleSlider` | `app.uiScale` |
| `shell.footer/schemeToggle` | `app.schemeToggle` |
| `view.servers`, `view.favourites`, `view.recent` | `layout/views/browser.json` (ADR-0005) |
| `view.mods` | `layout/views/mods.json` |
| `filterBar/searchInput` | `filter.search` |
| `filterBar/mapFilter`, `tagsFilter`, `modsFilter`, `countryFilter`, `sortControl`, `pingSlider` | `filter.map`, `filter.tags`, `filter.mods`, `filter.region`, `filter.sort`, `filter.maxPing` |
| `filterBar/refreshAction` | `servers.refresh` |
| the unregistered Reset button | `filter.reset` |
| `server.row` | `layout/lists/servers.json` |
| `server.row/favouriteAction` | `server.favourite` |
| `server.row/tagsLine` | `server.tags` |
| `server.row/modStatusBadge` | `server.modUpdate` |
| `server.row/name`, `mapLabel`, `gameTimeLabel`, `regionFlag`, `addressLabel`, `lastPlayedLabel` | `server.name`, `server.map`, `server.gameTime`, `server.region`, `server.address`, `server.lastPlayed` |
| `server.row/playerCount`, `pingBadge`, `modCountLabel` | `server.players`, `server.ping`, `server.modCount` |
| `server.rowActions/joinAction` | `server.join` |
| `server.rowActions/moreInfoItem`, `loadToMenuItem`, `downloadModsItem` | `server.info`, `server.loadToMenu`, `server.subscribeAll` |
| the row menu's notice line | `server.actionNotice` |
| `modal.serverInfo/closeAction` | `modal.close` |
| `modal.serverInfo/statGrid`, `propsList` | `surface.serverStats`, `surface.serverProps` |
| `modal.serverInfo/readinessStrip` | `server.readiness` |
| `modal.modFilter/closeAction`, `tabStrip`, `previewPane`, `applyAction` | `modal.close`, `modFilter.source`, a `modFilterPreview` container, `modFilter.apply` |
| `modal.update/closeAction`, `laterAction`, `installAction`, `viewReleaseAction` | `modal.close`, `update.later`, `update.install`, `update.viewRelease` |
| `mods.toolbar/searchInput`, `statusFilter`, `refreshAction` | `mods.search`, `mods.statusFilter`, `mods.refresh` |
| `mods.row` | `layout/lists/mods.json` |
| `mods.row/selectCheckbox`, `modIcon`, `modName`, `modTags`, `modStatusBadge`, `sizeLabel`, `updatedLabel` | `mod.select`, `mod.thumbnail`, `mod.name`, `mod.tags`, `mod.status`, `mod.size`, `mod.updated` |
| `mods.inspector` | a `modSelection` container |
| `mods.inspector/closeAction`, `previewImage`, `name`, `status`, `tags`, `description`, `detailFields` | `mod.deselect`, `mod.thumbnail`, `mod.name`, `mod.status`, `mod.tags`, `mod.description`, `surface.modDetails` |
| `mods.inspector/updateAction`, `openInSteamAction`, `openFolderAction`, `reinstallAction` | `mod.update`, `mod.openInSteam`, `mod.openFolder`, `mod.reinstall` |
| `mods.actionBar/*` | the `mods.*` action bar elements |
| `settings.background`, `settings.shell` | `layout/settings.json` |
| `settings.shell/backAction` | `settings.back` |
| `settings.game/sectionToggle` and the other two | accordion sections (SPEC §5.12) |
| `settings.game/*`, `settings.launcher/*` | the `settings.*` controls |
| `settings.theme/themeManagement` | `settings.themeManagement` |
| `modal.steamRequired/*`, `modal.onboarding/*` | removed: launcher-owned (ADR-0008) |
