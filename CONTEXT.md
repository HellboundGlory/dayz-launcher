# Tetra Launcher — Theme System

How a theme may restyle and rearrange Tetra Launcher's interface without touching the launcher's logic or data. This file is the glossary only; the design contract is `docs/theme-system/SPEC.md`.

## Language

### Boundaries

**Core content**:
Everything the launcher owns and keeps live: server and mod data, controls, and the actions behind them. A theme can place and style core content but never create it.
_Avoid_: app content, real content

**Presentation**:
How core content is arranged, sized, styled and worded on screen. Everything a theme controls is presentation.
_Avoid_: look and feel

**Behaviour**:
The launcher's logic: filtering, sorting, discovery, joining, mod management, Steam integration, settings persistence, and focus and keyboard handling. Never themeable.
_Avoid_: functionality, how it operates

**Launcher-owned screen**:
A screen whose layout and styling no theme can change: Steam required, first-run setup, the Activation Safety Window and the splash.
_Avoid_: locked slot, restricted slot, capped slot

**Launcher-owned block**:
A part of a themeable screen that a theme can place whole but can't lay out or style inside: theme management in Settings, and the confirmation for any destructive action.
_Avoid_: locked widget

### Themes

**Theme**:
A named set of presentation choices a user can activate.

**Theme package**:
The files that make up one theme, portable as a single archive.
_Avoid_: skin (for packages), mod

**Built-in theme**:
A theme that ships inside the launcher and can't be deleted. Neutral is the built-in default.
_Avoid_: preset

**Starter**:
A bundled theme package meant to be copied as the beginning of a new theme.
_Avoid_: template (for packages)

**Capability**:
A kind of customisation a theme package declares it uses: tokens, CSS, fonts, images, layout or theme settings.
_Avoid_: tier, Basic, Advanced, Expert

**Token**:
A named design value, such as a colour, a corner radius or a spacing step, that the whole interface reads.
_Avoid_: variable (in design discussion)

**Theme setting**:
An option a theme defines for its users to tune, such as compact rows or navigation placement.

**Incompatible theme**:
An installed theme made for an older theme format; it can be deleted but not activated.

### Layout

**Layout**:
A theme's arrangement of the whole window, made up of screens.

**Screen**:
One independently laid-out part of the interface: the shell, a view, Settings, a modal, a list or a popup.

**Shell**:
The window frame that stays in place while the user moves between views.

**View**:
One of the launcher's fixed destinations: the server browser or Mods. Exactly one view is shown at a time.
_Avoid_: page, tab (for views)

**Server browser**:
The view listing servers, shown in one of three scopes.

**Scope**:
Which servers the server browser shows: all servers, favourites, or recently played.
_Avoid_: view (for Servers, Favourites and Recent)

**Settings**:
The screen holding every launcher preference; a theme decides whether it appears as a view, an overlay or a panel.

**Modal**:
A focused task layered over the window: server info, the mod filter or an update prompt.

**Popup**:
Short-lived content opened from a control, such as a filter's choices or a server's actions menu.
_Avoid_: dropdown (for the concept)

**Region**:
A named area of a layout that other parts of the layout can refer to, such as a collapsible side area or the area a popup opens into.

**Outlet**:
The place in the shell where the current view appears.

**Variant**:
An alternative arrangement of a screen used within a range of window widths.

**Section**:
One expanding part of a screen whose header is always shown and whose contents open on demand, such as Settings' Game, Launcher and Theme sections.

### Content pieces

**Element**:
A single piece of core content a theme can place anywhere its context allows, known by a stable id, such as a server's Join action or the search box.
_Avoid_: slot, child, core ref

**Part**:
A named piece inside an element, such as a stat's value and its caption, that a theme's styling can target.
_Avoid_: sub-element, child

**Surface**:
A launcher-provided, ready-made group of elements that a theme uses whole or not at all.
_Avoid_: widget, component (for groups)

**Launcher label**:
Text tied to behaviour and worded by the launcher, such as a Join action's wording.

**Theme text**:
Plain decorative text a theme adds, such as a section heading.

**Decoration**:
An image a theme adds purely for looks; it carries no meaning.

**Notice**:
A launcher message about the state of the app or of an action: an update being available, storage being degraded, an error, or the outcome of acting on a server.

### Lists and selection

**List**:
A launcher-owned sequence of entries that a theme presents through a row template: servers, mods, mod filter results, the servers needing a mod, or a server's required mods.

**Entry**:
One item shown in a list.
_Avoid_: item (clashes with Workshop items), row (for the data)

**Server entry**:
One server shown in the server browser's list. Every server entry carries a Join action.

**Row template**:
The layout every entry of one list is presented with.

**Column**:
A named, aligned position shared by a list's header and its row template.

**Selection**:
The server the user has chosen, shared across the whole window. The Mods view has its own mod selection.
_Avoid_: focus (keyboard focus is separate), hover

**Context**:
What a server- or mod-specific element describes: the entry it sits in, the modal it's inside, or the selection.

**Detail panel**:
A region of a layout that shows whatever is selected.
_Avoid_: details rail, inspector, sidebar

**Readiness**:
Whether a server's required mods are installed and up to date, per mod and overall.

**Cared-about server**:
A server the user has favourited or played before.

### Safety

**Required element**:
An element every layout must place so the launcher stays usable, such as the window controls, navigation, or Join on each server entry.

**Validation**:
The check a theme package must pass before it can be installed or shown.

**Visibility check**:
The check, while a theme is showing, that required elements are actually visible, uncovered and reachable by keyboard.
_Avoid_: probe, runtime check

**Fallback**:
Showing Neutral's layout for one screen of a theme that failed validation or the visibility check, while the rest of the theme stays in effect.

**Activation Safety Window**:
The countdown after switching themes during which the user confirms the change or it reverts.
_Avoid_: revert box, guard popup
