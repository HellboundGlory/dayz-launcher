# Token map

The v2 token spine exposes Neutral scales and semantic roles on the document root. Role values are scale step names or literals; the emitter resolves each step against its matching scale before writing CSS. Palette variables and `--glow` retain their existing names and derivation.

Call sites below are representative sources for these defaults, not migrated consumers. Packages 2.2–2.4 replace their literals and split roles where values differ; this package changes no component styling. `type.family.ui` and `type.family.data` use the system stacks required by Package 2.1; today’s legacy font variables still use Inter and JetBrains Mono, so migrating those consumers needs the visual-regression check.

Type roles expose five variables; motion roles expose duration and easing separately. Scale and role names overlap at `border.hairline` and `shadow.glow`: the final variable holds the resolved role, not a self-referencing `var()`. `onAccent2` uses the solid-accent contrast precedent because no current solid-accent2 control exists; row color roles alias the existing live palette variables rather than replacing current row backgrounds. Overlay duration is zero because current modals mount without an entrance transition.

`applyTheme(palette, scheme, extras, tokens?)` retains its existing three-argument behavior. Explicit v2 colors and bloom override those arguments; the store passes only scales and roles because its effective palette and live bloom already include editor overrides. Installed v2 files are schema-checked by the backend; the v1 envelope remains supported until the package-format cutover. Paths without a `src/` prefix below are relative to `src/components/`.

| Role | CSS Variable | Default | Call Sites |
|---|---|---|---|
| `radius.window` | `--t-radius-window` | `lg` → `8px` | src/App.tsx:789, root rounded-[8px] |
| `radius.panel` | `--t-radius-panel` | `9px` | settings-accordion.tsx:46, section rounded-[9px] |
| `radius.card` | `--t-radius-card` | `lg` → `8px` | themes-page/ThemeCard.tsx:72 |
| `radius.modal` | `--t-radius-modal` | `10px` | server-info-modal.tsx:193 |
| `radius.popup` | `--t-radius-popup` | `7px` | server-row-actions.tsx:233; filter-bar.tsx:318 |
| `radius.row` | `--t-radius-row` | `lg` → `8px` | server-list.tsx:464; mods-tab.tsx:482 |
| `radius.control` | `--t-radius-control` | `md` → `6px` | server-row-actions.tsx:190,218; filter-bar.tsx:90 |
| `radius.input` | `--t-radius-input` | `md` → `6px` | filter-bar.tsx:298, search wrapper; settings-view.tsx:33 |
| `radius.chip` | `--t-radius-chip` | `sm` → `4px` | server-list.tsx:573, Tag |
| `radius.badge` | `--t-radius-badge` | `3px` | server-info-modal.tsx:666, Badge |
| `radius.thumb` | `--t-radius-thumb` | `7px` | mods-tab.tsx:560, modIcon image wrapper |
| `radius.track` | `--t-radius-track` | `xs` → `2px` | footer-bar.tsx:136, scale track |
| `radius.pill` | `--t-radius-pill` | `full` → `9999px` | footer-bar.tsx:68, Steam state; mods-tab.tsx:601, status pill |
| `space.windowPad` | `--t-space-windowPad` | `0` → `0px` | src/App.tsx:789, root has no padding; main.css:55-57 resets body/html |
| `space.panelPad` | `--t-space-panelPad` | `16` → `16px` | settings-accordion.tsx:79, body px-4 py-4 |
| `space.modalPad` | `--t-space-modalPad` | `14` → `14px` | server-info-modal.tsx:205, identity p-3.5 |
| `space.popupPad` | `--t-space-popupPad` | `4` → `4px` | server-row-actions.tsx:233, menu p-1 |
| `space.rowX` | `--t-space-rowX` | `12` → `12px` | server-list.tsx:464, px-3 |
| `space.rowY` | `--t-space-rowY` | `8` → `8px` | server-list.tsx:464, py-2 |
| `space.controlX` | `--t-space-controlX` | `12` → `12px` | server-row-actions.tsx:190, Join px-3 |
| `space.controlY` | `--t-space-controlY` | `6` → `6px` | server-row-actions.tsx:190, Join py-1.5 |
| `space.chipX` | `--t-space-chipX` | `4` → `4px` | server-list.tsx:573, Tag px-1 |
| `space.chipY` | `--t-space-chipY` | `1px` | server-list.tsx:573, Tag py-px; 1 is not a §4.3 space step |
| `space.stackGap` | `--t-space-stackGap` | `12` → `12px` | themes-page/ImportThemeDialog.tsx:281, flex-col gap-3 |
| `space.inlineGap` | `--t-space-inlineGap` | `6` → `6px` | server-row-actions.tsx:190, Join icon/label gap-1.5 |
| `space.sectionGap` | `--t-space-sectionGap` | `14` → `14px` | theme-customiser.tsx:118,245,293, subsection mt-3.5; settings-view.tsx:405 field mb-3.5 |
| `space.listGap` | `--t-space-listGap` | `6` → `6px` | server-list.tsx:416, virtualizer gap: 6 (not a CSS utility) |
| `type.display.family` | `--t-type-display-family` | `data` → `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | server-info-modal.tsx:675, Stat value |
| `type.display.size` | `--t-type-display-size` | `3xl` → `22px` | server-info-modal.tsx:675, Stat value |
| `type.display.weight` | `--t-type-display-weight` | `extrabold` → `800` | server-info-modal.tsx:675, Stat value |
| `type.display.tracking` | `--t-type-display-tracking` | `none` → `0` | server-info-modal.tsx:675, Stat value |
| `type.display.leading` | `--t-type-display-leading` | `none` → `1` | server-info-modal.tsx:675, Stat value |
| `type.heading.family` | `--t-type-heading-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-info-modal.tsx:206, server-name h2 |
| `type.heading.size` | `--t-type-heading-size` | `2xl` → `14px` | server-info-modal.tsx:206, server-name h2 |
| `type.heading.weight` | `--t-type-heading-weight` | `bold` → `700` | server-info-modal.tsx:206, server-name h2 |
| `type.heading.tracking` | `--t-type-heading-tracking` | `none` → `0` | server-info-modal.tsx:206, server-name h2 |
| `type.heading.leading` | `--t-type-heading-leading` | `snug` → `1.375` | server-info-modal.tsx:206, server-name h2 |
| `type.subheading.family` | `--t-type-subheading-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | settings-accordion.tsx:63, title |
| `type.subheading.size` | `--t-type-subheading-size` | `lg` → `12px` | settings-accordion.tsx:63, title |
| `type.subheading.weight` | `--t-type-subheading-weight` | `semibold` → `600` | settings-accordion.tsx:63, title |
| `type.subheading.tracking` | `--t-type-subheading-tracking` | `none` → `0` | settings-accordion.tsx:63, title |
| `type.subheading.leading` | `--t-type-subheading-leading` | `normal` → `1.5` | settings-accordion.tsx:63, title |
| `type.body.family` | `--t-type-body-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.body.size` | `--t-type-body-size` | `md` → `11px` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.body.weight` | `--t-type-body-weight` | `normal` → `400` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.body.tracking` | `--t-type-body-tracking` | `none` → `0` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.body.leading` | `--t-type-body-leading` | `normal` → `1.5` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.label.family` | `--t-type-label-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | settings-view.tsx:406, field label |
| `type.label.size` | `--t-type-label-size` | `sm` → `10px` | settings-view.tsx:406, field label |
| `type.label.weight` | `--t-type-label-weight` | `semibold` → `600` | settings-view.tsx:406, field label |
| `type.label.tracking` | `--t-type-label-tracking` | `none` → `0` | settings-view.tsx:406, field label |
| `type.label.leading` | `--t-type-label-leading` | `normal` → `1.5` | settings-view.tsx:406, field label |
| `type.caption.family` | `--t-type-caption-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | settings-view.tsx:407, field hint |
| `type.caption.size` | `--t-type-caption-size` | `xs` → `9px` | settings-view.tsx:407, field hint |
| `type.caption.weight` | `--t-type-caption-weight` | `normal` → `400` | settings-view.tsx:407, field hint |
| `type.caption.tracking` | `--t-type-caption-tracking` | `none` → `0` | settings-view.tsx:407, field hint |
| `type.caption.leading` | `--t-type-caption-leading` | `1.4` | settings-view.tsx:407, field hint |
| `type.micro.family` | `--t-type-micro-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.micro.size` | `--t-type-micro-size` | `2xs` → `8px` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.micro.weight` | `--t-type-micro-weight` | `normal` → `400` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.micro.tracking` | `--t-type-micro-tracking` | `none` → `0` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.micro.leading` | `--t-type-micro-leading` | `normal` → `1.5` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.button.family` | `--t-type-button-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-row-actions.tsx:190, Join |
| `type.button.size` | `--t-type-button-size` | `sm` → `10px` | server-row-actions.tsx:190, Join |
| `type.button.weight` | `--t-type-button-weight` | `bold` → `700` | server-row-actions.tsx:190, Join |
| `type.button.tracking` | `--t-type-button-tracking` | `wider` → `0.05em` | server-row-actions.tsx:190, Join |
| `type.button.leading` | `--t-type-button-leading` | `normal` → `1.5` | server-row-actions.tsx:190, Join |
| `type.chip.family` | `--t-type-chip-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:573, Tag |
| `type.chip.size` | `--t-type-chip-size` | `2xs` → `8px` | server-list.tsx:573, Tag |
| `type.chip.weight` | `--t-type-chip-weight` | `bold` → `700` | server-list.tsx:573, Tag |
| `type.chip.tracking` | `--t-type-chip-tracking` | `0.04em` | server-list.tsx:573, Tag |
| `type.chip.leading` | `--t-type-chip-leading` | `1.3` | server-list.tsx:573, Tag |
| `type.data.family` | `--t-type-data-family` | `data` → `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | server-info-modal.tsx:209, server address; :684, property value |
| `type.data.size` | `--t-type-data-size` | `sm` → `10px` | server-info-modal.tsx:209, server address; :684, property value |
| `type.data.weight` | `--t-type-data-weight` | `normal` → `400` | server-info-modal.tsx:209, server address; :684, property value |
| `type.data.tracking` | `--t-type-data-tracking` | `none` → `0` | server-info-modal.tsx:209, server address; :684, property value |
| `type.data.leading` | `--t-type-data-leading` | `normal` → `1.5` | server-info-modal.tsx:209, server address; :684, property value |
| `type.rowName.family` | `--t-type-rowName-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowName.size` | `--t-type-rowName-size` | `lg` → `12px` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowName.weight` | `--t-type-rowName-weight` | `semibold` → `600` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowName.tracking` | `--t-type-rowName-tracking` | `none` → `0` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowName.leading` | `--t-type-rowName-leading` | `normal` → `1.5` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowMeta.family` | `--t-type-rowMeta-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:491, detail-line parent |
| `type.rowMeta.size` | `--t-type-rowMeta-size` | `xs` → `9px` | server-list.tsx:491, detail-line parent |
| `type.rowMeta.weight` | `--t-type-rowMeta-weight` | `normal` → `400` | server-list.tsx:491, detail-line parent |
| `type.rowMeta.tracking` | `--t-type-rowMeta-tracking` | `none` → `0` | server-list.tsx:491, detail-line parent |
| `type.rowMeta.leading` | `--t-type-rowMeta-leading` | `normal` → `1.5` | server-list.tsx:491, detail-line parent |
| `type.statValue.family` | `--t-type-statValue-family` | `data` → `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | server-list.tsx:154, player count; :186 ping |
| `type.statValue.size` | `--t-type-statValue-size` | `xl` → `13px` | server-list.tsx:154, player count; :186 ping |
| `type.statValue.weight` | `--t-type-statValue-weight` | `bold` → `700` | server-list.tsx:154, player count; :186 ping |
| `type.statValue.tracking` | `--t-type-statValue-tracking` | `none` → `0` | server-list.tsx:154, player count; :186 ping |
| `type.statValue.leading` | `--t-type-statValue-leading` | `none` → `1` | server-list.tsx:154, player count; :186 ping |
| `type.statCaption.family` | `--t-type-statCaption-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `type.statCaption.size` | `--t-type-statCaption-size` | `3xs` → `7px` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `type.statCaption.weight` | `--t-type-statCaption-weight` | `bold` → `700` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `type.statCaption.tracking` | `--t-type-statCaption-tracking` | `0.07em` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `type.statCaption.leading` | `--t-type-statCaption-leading` | `normal` → `1.5` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `color.onAccent` | `--t-color-onAccent` | `#10131a` | server-row-actions.tsx:190; server-info-modal.tsx:375,386; solid accent Join/Load |
| `color.onAccent2` | `--t-color-onAccent2` | `#10131a` | No solid-accent2 text-bearing control found. Closest contrast precedent is the solid-accent Join above. Actual accent2 swatches at theme-customiser.tsx:134,169,204 are empty <i> elements; server-list.tsx:552 and server-info-modal.tsx:663 use accent2-soft + accent2 foreground, not onAccent2. |
| `color.onDanger` | `--t-color-onDanger` | `#10131a` | server-row-actions.tsx:401; server-info-modal.tsx:605; destructive solid-danger buttons |
| `color.focusRing` | `--t-color-focusRing` | `var(--accent-line)` | src/main.css:73-75, global 2px focus-visible outline |
| `color.scrim` | `--t-color-scrim` | `rgba(5,8,13,0.7)` | server-info-modal.tsx:183; mod-filter-modal.tsx:366; ImportThemeDialog.tsx:248 |
| `color.rowHover` | `--t-color-rowHover` | `var(--row-hover)` | src/main.css:36 definition and src/theme/apply.ts:62 derivation; no current JSX consumer [INFERENCE for mapping to row backgrounds] |
| `color.rowSelected` | `--t-color-rowSelected` | `var(--row-selected)` | src/main.css:37 definition and src/theme/apply.ts:63 derivation; no current JSX consumer [INFERENCE for mapping to selected rows] |
| `border.hairline` | `--t-border-hairline` | `hairline` → `1px` | src/App.tsx:789 border; src/main.css:226 changelog pre border:1px |
| `border.control` | `--t-border-control` | `hairline` → `1px` | server-row-actions.tsx:218, menu trigger border; settings-view.tsx:33 input border |
| `border.focus` | `--t-border-focus` | `thick` → `2px` | src/main.css:74 outline:2px; theme-customiser.tsx:105 peer-focus-visible:ring-2 |
| `shadow.panel` | `--t-shadow-panel` | `none` | settings-accordion.tsx:46, unshadowed panel; no shadow utility on panel or ancestors shown |
| `shadow.modal` | `--t-shadow-modal` | `lg` → `0 12px 40px rgba(0,0,0,0.5)` | server-info-modal.tsx:193 |
| `shadow.popup` | `--t-shadow-popup` | `sm` → `0 8px 24px rgba(0,0,0,0.4)` | server-row-actions.tsx:233; ThemeCard.tsx:137 |
| `shadow.drawer` | `--t-shadow-drawer` | `-10px 0 26px rgba(0,0,0,0.4)` | mods-tab.tsx:798, inspector; no matching shadow scale step |
| `shadow.glow` | `--t-shadow-glow` | `glow` → `var(--glow)` | server-list.tsx:467 and server-row-actions.tsx:190; src/main.css:42-46 and src/theme/apply.ts:65-75 |
| `motion.hover.duration` | `--t-motion-hover-duration` | `fast` → `150ms` | server-list.tsx:464 explicit duration-150; server-row-actions.tsx:190 transition-colors inherits Tailwind default |
| `motion.hover.easing` | `--t-motion-hover-easing` | `standard` → `cubic-bezier(0.4, 0, 0.2, 1)` | server-list.tsx:464 explicit duration-150; server-row-actions.tsx:190 transition-colors inherits Tailwind default |
| `motion.expand.duration` | `--t-motion-expand-duration` | `normal` → `200ms` | settings-accordion.tsx:68 chevron; sidebar.tsx:226-227 width transition |
| `motion.expand.easing` | `--t-motion-expand-easing` | `standard` → `cubic-bezier(0.4, 0, 0.2, 1)` | settings-accordion.tsx:68 chevron; sidebar.tsx:226-227 width transition |
| `motion.overlay.duration` | `--t-motion-overlay-duration` | `0ms` | server-info-modal.tsx:182-193 and update-modal.tsx:46-60 mount/unmount instantly with no overlay transition; don't introduce a fade |
| `motion.overlay.easing` | `--t-motion-overlay-easing` | `standard` → `cubic-bezier(0.4, 0, 0.2, 1)` | server-info-modal.tsx:182-193 and update-modal.tsx:46-60 mount/unmount instantly with no overlay transition; don't introduce a fade |

## Migration boundaries

Do not apply one role indiscriminately to differently styled consumers. Existing differences include 10px versus 12px modals, 7px versus 8px popups, server versus Mods row padding and typography, 1.5px checkbox borders, and literal directional drawer shadows. Preserve those differences with named variants in the consumer-refactor packages and update this map and SPEC §4.4 together.
