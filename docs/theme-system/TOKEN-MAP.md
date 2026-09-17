# Token map

The v2 token spine exposes Neutral scales and semantic roles on the document root. Role values are scale step names or literals; the emitter resolves each step against its matching scale before writing CSS. Palette variables and `--glow` retain their existing names and derivation.

Packages 2.2, 2.3, 2.4a, and 2.4b migrate the shell, controls, server browser, Mods, Settings, Update, Themes page, and theme customizer components listed below. Other sources remain migration references for subsequent packages. Consumers bind individual type properties: unmentioned properties still inherit their existing values, including legacy Inter/JetBrains Mono families; the v2 system-family defaults are unchanged. Structural zero/full-size utilities and layout-slot width overrides remain structural constraints, not spacing defaults.

Type roles expose five variables; motion roles expose duration and easing separately. Shell consumers use arbitrary CSS property utilities (for example `[font-size:var(--t-type-body-size)]`) so no literal-style utility prefixes remain. New radius, spacing, brand tracking and shadow variants preserve the original computed values; slider knob travel derives from the track and knob roles. Scale/role collisions at `border.hairline` and `shadow.glow` resolve to values, not self-references.

`applyTheme(palette, scheme, extras, tokens?)` retains its existing three-argument behavior. Explicit v2 colors and bloom override those arguments; the store passes only scales and roles because its effective palette and live bloom already include editor overrides. Installed v2 files are schema-checked by the backend; the v1 envelope remains supported until the package-format cutover. Paths without a `src/` prefix below are relative to `src/components/`.

| Role | CSS Variable | Default | Call Sites |
|---|---|---|---|
| `radius.window` | `--t-radius-window` | `lg` → `8px` | src/App.tsx:789, root rounded-[8px]; migrated: src/App.tsx:789 |
| `radius.panel` | `--t-radius-panel` | `9px` | settings-accordion.tsx:46, section rounded-[9px] |
| `radius.card` | `--t-radius-card` | `lg` → `8px` | themes-page/ThemeCard.tsx:72 |
| `radius.modal` | `--t-radius-modal` | `10px` | server-info-modal.tsx:193; Package 2.3: src/components/server-info-modal.tsx:193 |
| `radius.popup` | `--t-radius-popup` | `7px` | server-row-actions.tsx:233; filter-bar.tsx:318; migrated: src/components/filter-bar.tsx:318; Package 2.3: src/components/server-row-actions.tsx:233; src/components/server-info-modal.tsx:396 |
| `radius.row` | `--t-radius-row` | `lg` → `8px` | server-list.tsx:464; mods-tab.tsx:482; Package 2.3: src/components/server-list.tsx:464 |
| `radius.control` | `--t-radius-control` | `md` → `6px` | server-row-actions.tsx:190,218; filter-bar.tsx:90; migrated: src/components/filter-bar.tsx:90,106,122,138,151,166,397; Package 2.3: src/components/server-row-actions.tsx:190,218,391,401; src/components/server-info-modal.tsx:334,341,354,375,386,595,605 |
| `radius.input` | `--t-radius-input` | `md` → `6px` | filter-bar.tsx:298, search wrapper; settings-view.tsx:33; migrated: src/components/filter-bar.tsx:299 |
| `radius.chip` | `--t-radius-chip` | `sm` → `4px` | server-list.tsx:573, Tag; Package 2.3: src/components/server-list.tsx:573 |
| `radius.badge` | `--t-radius-badge` | `3px` | server-info-modal.tsx:666, Badge; Package 2.3: src/components/server-info-modal.tsx:666 |
| `radius.thumb` | `--t-radius-thumb` | `7px` | mods-tab.tsx:560, modIcon image wrapper |
| `radius.track` | `--t-radius-track` | `xs` → `2px` | footer-bar.tsx:136, scale track; migrated: src/components/footer-bar.tsx:132,146 |
| `radius.pill` | `--t-radius-pill` | `full` → `9999px` | footer-bar.tsx:68, Steam state; mods-tab.tsx:601, status pill; migrated: src/components/footer-bar.tsx:64,72,134,162; src/components/filter-bar.tsx:722 |
| `space.windowPad` | `--t-space-windowPad` | `0` → `0px` | src/App.tsx:789, root has no padding; main.css:55-57 resets body/html |
| `space.panelPad` | `--t-space-panelPad` | `16` → `16px` | settings-accordion.tsx:79, body px-4 py-4 |
| `space.modalPad` | `--t-space-modalPad` | `14` → `14px` | server-info-modal.tsx:205, identity p-3.5 |
| `space.popupPad` | `--t-space-popupPad` | `4` → `4px` | server-row-actions.tsx:233, menu p-1 |
| `space.rowX` | `--t-space-rowX` | `12` → `12px` | server-list.tsx:464, px-3; migrated: src/App.tsx:801,843,856; src/components/sidebar.tsx:127 |
| `space.rowY` | `--t-space-rowY` | `8` → `8px` | server-list.tsx:464, py-2; migrated: src/components/sidebar.tsx:110,168; src/components/filter-bar.tsx:253 |
| `space.controlX` | `--t-space-controlX` | `12` → `12px` | server-row-actions.tsx:190, Join px-3 |
| `space.controlY` | `--t-space-controlY` | `6` → `6px` | server-row-actions.tsx:190, Join py-1.5; migrated: src/App.tsx:801,843,856; src/components/filter-bar.tsx:341,487 |
| `space.chipX` | `--t-space-chipX` | `4` → `4px` | server-list.tsx:573, Tag px-1 |
| `space.chipY` | `--t-space-chipY` | `1px` | server-list.tsx:573, Tag py-px; 1 is not a §4.3 space step |
| `space.stackGap` | `--t-space-stackGap` | `12` → `12px` | themes-page/ImportThemeDialog.tsx:281, flex-col gap-3; migrated: src/App.tsx:801 |
| `space.inlineGap` | `--t-space-inlineGap` | `6` → `6px` | server-row-actions.tsx:190, Join icon/label gap-1.5; migrated: src/components/sidebar.tsx:159; src/components/footer-bar.tsx:64; src/components/filter-bar.tsx:253,299,397,708 |
| `space.sectionGap` | `--t-space-sectionGap` | `14` → `14px` | theme-customiser.tsx:118,245,293, subsection mt-3.5; settings-view.tsx:405 field mb-3.5 |
| `space.listGap` | `--t-space-listGap` | `6` → `6px` | server-list.tsx:416, virtualizer gap: 6 (not a CSS utility) |
| `type.display.family` | `--t-type-display-family` | `data` → `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | server-info-modal.tsx:675, Stat value |
| `type.display.size` | `--t-type-display-size` | `3xl` → `22px` | server-info-modal.tsx:675, Stat value; Package 2.3: src/components/server-info-modal.tsx:675 |
| `type.display.weight` | `--t-type-display-weight` | `extrabold` → `800` | server-info-modal.tsx:675, Stat value |
| `type.display.tracking` | `--t-type-display-tracking` | `none` → `0` | server-info-modal.tsx:675, Stat value |
| `type.display.leading` | `--t-type-display-leading` | `none` → `1` | server-info-modal.tsx:675, Stat value |
| `type.heading.family` | `--t-type-heading-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-info-modal.tsx:206, server-name h2 |
| `type.heading.size` | `--t-type-heading-size` | `2xl` → `14px` | server-info-modal.tsx:206, server-name h2; Package 2.3: src/components/server-info-modal.tsx:206 |
| `type.heading.weight` | `--t-type-heading-weight` | `bold` → `700` | server-info-modal.tsx:206, server-name h2 |
| `type.heading.tracking` | `--t-type-heading-tracking` | `none` → `0` | server-info-modal.tsx:206, server-name h2 |
| `type.heading.leading` | `--t-type-heading-leading` | `snug` → `1.375` | server-info-modal.tsx:206, server-name h2; migrated: src/components/filter-bar.tsx:636 |
| `type.subheading.family` | `--t-type-subheading-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | settings-accordion.tsx:63, title |
| `type.subheading.size` | `--t-type-subheading-size` | `lg` → `12px` | settings-accordion.tsx:63, title; migrated: src/components/sidebar.tsx:110,168 |
| `type.subheading.weight` | `--t-type-subheading-weight` | `semibold` → `600` | settings-accordion.tsx:63, title |
| `type.subheading.tracking` | `--t-type-subheading-tracking` | `none` → `0` | settings-accordion.tsx:63, title |
| `type.subheading.leading` | `--t-type-subheading-leading` | `normal` → `1.5` | settings-accordion.tsx:63, title |
| `type.body.family` | `--t-type-body-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.body.size` | `--t-type-body-size` | `md` → `11px` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label; migrated: src/App.tsx:805,847,860; src/components/filter-bar.tsx:308; Package 2.3: src/components/server-list.tsx:437; src/components/server-row-actions.tsx:387,463; src/components/server-info-modal.tsx:405,533,591 |
| `type.body.weight` | `--t-type-body-weight` | `normal` → `400` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.body.tracking` | `--t-type-body-tracking` | `none` → `0` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.body.leading` | `--t-type-body-leading` | `normal` → `1.5` | src/App.tsx:805, update message; settings-view.tsx:434, checkbox label |
| `type.label.family` | `--t-type-label-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | settings-view.tsx:406, field label |
| `type.label.size` | `--t-type-label-size` | `sm` → `10px` | settings-view.tsx:406, field label; migrated: src/App.tsx:802,813,819,844,857,863; src/components/footer-bar.tsx:85; src/components/filter-bar.tsx:90,106,122,138,151,166,341,397,487,563,708; Package 2.3: src/components/server-info-modal.tsx:304,511,520,525,621,636,640,643 |
| `type.label.weight` | `--t-type-label-weight` | `semibold` → `600` | settings-view.tsx:406, field label; migrated: src/App.tsx:802,819,844,857; src/components/sidebar.tsx:110,168; src/components/footer-bar.tsx:64,88,93,109,119; src/components/filter-bar.tsx:341,402 |
| `type.label.tracking` | `--t-type-label-tracking` | `none` → `0` | settings-view.tsx:406, field label |
| `type.label.leading` | `--t-type-label-leading` | `normal` → `1.5` | settings-view.tsx:406, field label |
| `type.caption.family` | `--t-type-caption-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | settings-view.tsx:407, field hint |
| `type.caption.size` | `--t-type-caption-size` | `xs` → `9px` | settings-view.tsx:407, field hint; migrated: src/components/footer-bar.tsx:64,129,149; Package 2.3: src/components/server-row-actions.tsx:342,359; src/components/server-info-modal.tsx:684 |
| `type.caption.weight` | `--t-type-caption-weight` | `normal` → `400` | settings-view.tsx:407, field hint |
| `type.caption.tracking` | `--t-type-caption-tracking` | `none` → `0` | settings-view.tsx:407, field hint |
| `type.caption.leading` | `--t-type-caption-leading` | `1.4` | settings-view.tsx:407, field hint |
| `type.micro.family` | `--t-type-micro-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.micro.size` | `--t-type-micro-size` | `2xs` → `8px` | theme-customiser.tsx:120, Presets + your saved skins; migrated: src/components/filter-bar.tsx:357,636; Package 2.3: src/components/server-info-modal.tsx:666,676 |
| `type.micro.weight` | `--t-type-micro-weight` | `normal` → `400` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.micro.tracking` | `--t-type-micro-tracking` | `none` → `0` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.micro.leading` | `--t-type-micro-leading` | `normal` → `1.5` | theme-customiser.tsx:120, Presets + your saved skins |
| `type.button.family` | `--t-type-button-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-row-actions.tsx:190, Join |
| `type.button.size` | `--t-type-button-size` | `sm` → `10px` | server-row-actions.tsx:190, Join; Package 2.3: src/components/server-row-actions.tsx:190,391,401; src/components/server-info-modal.tsx:334,341,354,375,477,486,495,503,595,605 |
| `type.button.weight` | `--t-type-button-weight` | `bold` → `700` | server-row-actions.tsx:190, Join; migrated: src/App.tsx:813; src/components/sidebar.tsx:142; src/components/footer-bar.tsx:131; src/components/filter-bar.tsx:90,106,122,138,151,166,357,397,710 |
| `type.button.tracking` | `--t-type-button-tracking` | `wider` → `0.05em` | server-row-actions.tsx:190, Join; migrated: src/App.tsx:802,813,819; src/components/footer-bar.tsx:129; src/components/filter-bar.tsx:90,106,122,138,151,166,357,710 |
| `type.button.leading` | `--t-type-button-leading` | `normal` → `1.5` | server-row-actions.tsx:190, Join |
| `type.chip.family` | `--t-type-chip-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:573, Tag |
| `type.chip.size` | `--t-type-chip-size` | `2xs` → `8px` | server-list.tsx:573, Tag; Package 2.3: src/components/server-list.tsx:573 |
| `type.chip.weight` | `--t-type-chip-weight` | `bold` → `700` | server-list.tsx:573, Tag |
| `type.chip.tracking` | `--t-type-chip-tracking` | `0.04em` | server-list.tsx:573, Tag; Package 2.3: src/components/server-list.tsx:573 |
| `type.chip.leading` | `--t-type-chip-leading` | `1.3` | server-list.tsx:573, Tag; Package 2.3: src/components/server-list.tsx:573 |
| `type.data.family` | `--t-type-data-family` | `data` → `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | server-info-modal.tsx:209, server address; :684, property value |
| `type.data.size` | `--t-type-data-size` | `sm` → `10px` | server-info-modal.tsx:209, server address; :684, property value; Package 2.3: src/components/server-list.tsx:166; src/components/server-info-modal.tsx:209,554,685 |
| `type.data.weight` | `--t-type-data-weight` | `normal` → `400` | server-info-modal.tsx:209, server address; :684, property value |
| `type.data.tracking` | `--t-type-data-tracking` | `none` → `0` | server-info-modal.tsx:209, server address; :684, property value; migrated: src/components/footer-bar.tsx:149 |
| `type.data.leading` | `--t-type-data-leading` | `normal` → `1.5` | server-info-modal.tsx:209, server address; :684, property value |
| `type.rowName.family` | `--t-type-rowName-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowName.size` | `--t-type-rowName-size` | `lg` → `12px` | server-list.tsx:488, name-line parent; name child :115-119 inherits; Package 2.3: src/components/server-list.tsx:488 |
| `type.rowName.weight` | `--t-type-rowName-weight` | `semibold` → `600` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowName.tracking` | `--t-type-rowName-tracking` | `none` → `0` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowName.leading` | `--t-type-rowName-leading` | `normal` → `1.5` | server-list.tsx:488, name-line parent; name child :115-119 inherits |
| `type.rowMeta.family` | `--t-type-rowMeta-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:491, detail-line parent |
| `type.rowMeta.size` | `--t-type-rowMeta-size` | `xs` → `9px` | server-list.tsx:491, detail-line parent; Package 2.3: src/components/server-list.tsx:491 |
| `type.rowMeta.weight` | `--t-type-rowMeta-weight` | `normal` → `400` | server-list.tsx:491, detail-line parent |
| `type.rowMeta.tracking` | `--t-type-rowMeta-tracking` | `none` → `0` | server-list.tsx:491, detail-line parent |
| `type.rowMeta.leading` | `--t-type-rowMeta-leading` | `normal` → `1.5` | server-list.tsx:491, detail-line parent |
| `type.statValue.family` | `--t-type-statValue-family` | `data` → `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | server-list.tsx:154, player count; :186 ping |
| `type.statValue.size` | `--t-type-statValue-size` | `xl` → `13px` | server-list.tsx:154, player count; :186 ping; Package 2.3: src/components/server-list.tsx:152,183,526,534,542 |
| `type.statValue.weight` | `--t-type-statValue-weight` | `bold` → `700` | server-list.tsx:154, player count; :186 ping |
| `type.statValue.tracking` | `--t-type-statValue-tracking` | `none` → `0` | server-list.tsx:154, player count; :186 ping |
| `type.statValue.leading` | `--t-type-statValue-leading` | `none` → `1` | server-list.tsx:154, player count; :186 ping |
| `type.statCaption.family` | `--t-type-statCaption-family` | `ui` → `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `type.statCaption.size` | `--t-type-statCaption-size` | `3xs` → `7px` | server-list.tsx:176,199,208, Players/Ping/Mods captions; Package 2.3: src/components/server-list.tsx:173,196,204 |
| `type.statCaption.weight` | `--t-type-statCaption-weight` | `bold` → `700` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `type.statCaption.tracking` | `--t-type-statCaption-tracking` | `0.07em` | server-list.tsx:176,199,208, Players/Ping/Mods captions; Package 2.3: src/components/server-list.tsx:173,196,204 |
| `type.statCaption.leading` | `--t-type-statCaption-leading` | `normal` → `1.5` | server-list.tsx:176,199,208, Players/Ping/Mods captions |
| `color.onAccent` | `--t-color-onAccent` | `#10131a` | server-row-actions.tsx:190; server-info-modal.tsx:375,386; solid accent Join/Load; Package 2.3: src/components/server-row-actions.tsx:190; src/components/server-info-modal.tsx:375,386 |
| `color.onAccent2` | `--t-color-onAccent2` | `#10131a` | No solid-accent2 text-bearing control found. Closest contrast precedent is the solid-accent Join above. Actual accent2 swatches at theme-customiser.tsx:134,169,204 are empty <i> elements; server-list.tsx:552 and server-info-modal.tsx:663 use accent2-soft + accent2 foreground, not onAccent2. |
| `color.onDanger` | `--t-color-onDanger` | `#10131a` | server-row-actions.tsx:401; server-info-modal.tsx:605; destructive solid-danger buttons; Package 2.3: src/components/server-row-actions.tsx:401; src/components/server-info-modal.tsx:605 |
| `color.focusRing` | `--t-color-focusRing` | `var(--accent-line)` | src/main.css:73-75, global 2px focus-visible outline |
| `color.scrim` | `--t-color-scrim` | `rgba(5,8,13,0.7)` | server-info-modal.tsx:183; mod-filter-modal.tsx:366; ImportThemeDialog.tsx:248; Package 2.3: src/components/server-info-modal.tsx:183 |
| `color.rowHover` | `--t-color-rowHover` | `var(--row-hover)` | src/main.css:36 definition and src/theme/apply.ts:62 derivation; no current JSX consumer [INFERENCE for mapping to row backgrounds] |
| `color.rowSelected` | `--t-color-rowSelected` | `var(--row-selected)` | src/main.css:37 definition and src/theme/apply.ts:63 derivation; no current JSX consumer [INFERENCE for mapping to selected rows] |
| `border.hairline` | `--t-border-hairline` | `hairline` → `1px` | src/App.tsx:789 border; src/main.css:226 changelog pre border:1px; migrated: src/components/footer-bar.tsx:192; src/components/filter-bar.tsx:365 |
| `border.control` | `--t-border-control` | `hairline` → `1px` | server-row-actions.tsx:218, menu trigger border; settings-view.tsx:33 input border |
| `border.focus` | `--t-border-focus` | `thick` → `2px` | src/main.css:74 outline:2px; theme-customiser.tsx:105 peer-focus-visible:ring-2 |
| `shadow.panel` | `--t-shadow-panel` | `none` | settings-accordion.tsx:46, unshadowed panel; no shadow utility on panel or ancestors shown |
| `shadow.modal` | `--t-shadow-modal` | `lg` → `0 12px 40px rgba(0,0,0,0.5)` | server-info-modal.tsx:193; Package 2.3: src/components/server-info-modal.tsx:193 |
| `shadow.popup` | `--t-shadow-popup` | `sm` → `0 8px 24px rgba(0,0,0,0.4)` | server-row-actions.tsx:233; ThemeCard.tsx:137; Package 2.3: src/components/server-row-actions.tsx:233; src/components/server-info-modal.tsx:396 |
| `shadow.drawer` | `--t-shadow-drawer` | `-10px 0 26px rgba(0,0,0,0.4)` | mods-tab.tsx:798, inspector; no matching shadow scale step |
| `shadow.glow` | `--t-shadow-glow` | `glow` → `var(--glow)` | server-list.tsx:467 and server-row-actions.tsx:190; src/main.css:42-46 and src/theme/apply.ts:65-75; migrated: src/components/sidebar.tsx:111,139,169; src/components/footer-bar.tsx:73,134; src/components/filter-bar.tsx:169,398; Package 2.3: src/components/server-list.tsx:467,551; src/components/server-row-actions.tsx:190; src/components/server-info-modal.tsx:375,386 |
| `motion.hover.duration` | `--t-motion-hover-duration` | `fast` → `150ms` | server-list.tsx:464 explicit duration-150; server-row-actions.tsx:190 transition-colors inherits Tailwind default; migrated: src/App.tsx:813,819; src/components/sidebar.tsx:110,168,197,198; src/components/window-controls.tsx:44,53,62; src/components/footer-bar.tsx:134,162; src/components/filter-bar.tsx:90,106,122,138,151,166,341,357,397; Package 2.3: src/components/server-list.tsx:464 |
| `motion.hover.easing` | `--t-motion-hover-easing` | `standard` → `cubic-bezier(0.4, 0, 0.2, 1)` | server-list.tsx:464 explicit duration-150; server-row-actions.tsx:190 transition-colors inherits Tailwind default; migrated: src/App.tsx:813,819; src/components/sidebar.tsx:110,168,197,198; src/components/window-controls.tsx:44,53,62; src/components/footer-bar.tsx:134,162; src/components/filter-bar.tsx:90,106,122,138,151,166,341,357,397 |
| `motion.expand.duration` | `--t-motion-expand-duration` | `normal` → `200ms` | settings-accordion.tsx:68 chevron; sidebar.tsx:226-227 width transition; migrated: src/components/sidebar.tsx:226,227 |
| `motion.expand.easing` | `--t-motion-expand-easing` | `standard` → `cubic-bezier(0.4, 0, 0.2, 1)` | settings-accordion.tsx:68 chevron; sidebar.tsx:226-227 width transition; migrated: src/components/sidebar.tsx:226,227 |
| `motion.overlay.duration` | `--t-motion-overlay-duration` | `0ms` | server-info-modal.tsx:182-193 and update-modal.tsx:46-60 mount/unmount instantly with no overlay transition; don't introduce a fade |
| `motion.overlay.easing` | `--t-motion-overlay-easing` | `standard` → `cubic-bezier(0.4, 0, 0.2, 1)` | server-info-modal.tsx:182-193 and update-modal.tsx:46-60 mount/unmount instantly with no overlay transition; don't introduce a fade |
| `radius.sidebarItem` | `--t-radius-sidebarItem` | `7px` | src/components/sidebar.tsx:110,168 |
| `radius.controlSmall` | `--t-radius-controlSmall` | `sm → 4px` | src/App.tsx:813,819; src/components/sidebar.tsx:139,197,198 |
| `radius.popupItem` | `--t-radius-popupItem` | `5px` | src/components/filter-bar.tsx:341,357; Package 2.3: src/components/server-row-actions.tsx:463; src/components/server-info-modal.tsx:405 |
| `space.controlCompactX` | `--t-space-controlCompactX` | `8 → 8px` | src/App.tsx:819; src/components/filter-bar.tsx:90,106,122,138,151,166,341,357,397,487,636 |
| `space.controlCompactY` | `--t-space-controlCompactY` | `5px` | src/components/filter-bar.tsx:90,106,122,138,151,166,299,357,397 |
| `space.controlSmallX` | `--t-space-controlSmallX` | `10 → 10px` | src/App.tsx:813; src/components/sidebar.tsx:110,168; src/components/footer-bar.tsx:64; src/components/filter-bar.tsx:253,299 |
| `space.controlSmallY` | `--t-space-controlSmallY` | `2 → 2px` | src/App.tsx:813,819 |
| `space.sidebarPad` | `--t-space-sidebarPad` | `8 → 8px` | src/components/sidebar.tsx:151 |
| `space.sidebarSettingsPad` | `--t-space-sidebarSettingsPad` | `10 → 10px` | src/components/sidebar.tsx:159 |
| `space.sidebarLogoY` | `--t-space-sidebarLogoY` | `14 → 14px` | src/components/sidebar.tsx:127,128 |
| `space.sidebarListGap` | `--t-space-sidebarListGap` | `3px` | src/components/sidebar.tsx:151 |
| `space.sidebarItemGap` | `--t-space-sidebarItemGap` | `10 → 10px` | src/components/sidebar.tsx:110,168 |
| `space.inlineGapWide` | `--t-space-inlineGapWide` | `8 → 8px` | src/App.tsx:843,856; src/components/sidebar.tsx:133; src/components/footer-bar.tsx:85,129; src/components/filter-bar.tsx:253,341,562 |
| `space.inlineGapSmall` | `--t-space-inlineGapSmall` | `4 → 4px` | src/components/filter-bar.tsx:90,106,122,138,151,166 |
| `space.popupFilterPad` | `--t-space-popupFilterPad` | `5px` | src/components/filter-bar.tsx:318 |
| `space.popupOffset` | `--t-space-popupOffset` | `5px` | src/components/filter-bar.tsx:318 |
| `space.popupClearGap` | `--t-space-popupClearGap` | `7px` | src/components/filter-bar.tsx:357 |
| `space.separatorX` | `--t-space-separatorX` | `2 → 2px` | src/components/filter-bar.tsx:365,636,708 |
| `space.separatorY` | `--t-space-separatorY` | `4 → 4px` | src/components/filter-bar.tsx:365,636 |
| `space.footerX` | `--t-space-footerX` | `14 → 14px` | src/components/footer-bar.tsx:181 |
| `space.footerY` | `--t-space-footerY` | `7px` | src/components/footer-bar.tsx:181 |
| `space.footerGap` | `--t-space-footerGap` | `14 → 14px` | src/components/footer-bar.tsx:181 |
| `space.stateChipY` | `--t-space-stateChipY` | `3px` | src/components/footer-bar.tsx:64 |
| `space.windowControlWidth` | `--t-space-windowControlWidth` | `40 → 40px` | src/components/window-controls.tsx:44,53,62 |
| `space.windowControlHeight` | `--t-space-windowControlHeight` | `28 → 28px` | src/components/window-controls.tsx:44,53,62,75,89 |
| `space.sidebarWidth` | `--t-space-sidebarWidth` | `176px` | src/App.tsx:125; src/components/sidebar.tsx:64 |
| `space.sidebarToggleOffset` | `--t-space-sidebarToggleOffset` | `96px` | src/components/sidebar.tsx:197,198 |
| `space.sidebarToggleHeight` | `--t-space-sidebarToggleHeight` | `46 → 46px` | src/components/sidebar.tsx:197,198 |
| `space.searchMinWidth` | `--t-space-searchMinWidth` | `140px` | src/components/filter-bar.tsx:299 |
| `space.popupMinWidth` | `--t-space-popupMinWidth` | `190px` | src/components/filter-bar.tsx:318 |
| `space.popupMaxHeight` | `--t-space-popupMaxHeight` | `320px` | src/components/filter-bar.tsx:318 |
| `space.scaleTrackWidth` | `--t-space-scaleTrackWidth` | `120px` | src/components/footer-bar.tsx:132,135 |
| `space.scaleKnobSize` | `--t-space-scaleKnobSize` | `7px` | src/components/footer-bar.tsx:134,135 |
| `space.sliderHeight` | `--t-space-sliderHeight` | `3px` | src/components/footer-bar.tsx:132; src/components/filter-bar.tsx:722 |
| `space.stateDotSize` | `--t-space-stateDotSize` | `5px` | src/components/footer-bar.tsx:72 |
| `space.pingTrackWidth` | `--t-space-pingTrackWidth` | `56px` | src/components/filter-bar.tsx:722 |
| `space.dataWidth` | `--t-space-dataWidth` | `36 → 36px` | src/components/footer-bar.tsx:149; src/components/filter-bar.tsx:724 |
| `space.iconTiny` | `--t-space-iconTiny` | `11px` | src/components/filter-bar.tsx:405 |
| `space.iconSmall` | `--t-space-iconSmall` | `12 → 12px` | src/components/window-controls.tsx:55; src/components/filter-bar.tsx:154,173,301,346 |
| `space.iconChevron` | `--t-space-iconChevron` | `13px` | src/components/sidebar.tsx:202,204 |
| `space.iconMedium` | `--t-space-iconMedium` | `14 → 14px` | src/components/window-controls.tsx:46,64; src/components/footer-bar.tsx:165,167,192; src/components/filter-bar.tsx:345 |
| `space.iconLarge` | `--t-space-iconLarge` | `18 → 18px` | src/components/sidebar.tsx:116,139,174,197,198 |
| `space.iconBox` | `--t-space-iconBox` | `22 → 22px` | src/components/sidebar.tsx:115,173; src/components/footer-bar.tsx:162 |
| `space.sidebarCollapsedWidth` | `--t-space-sidebarCollapsedWidth` | `52px` | src/App.tsx:122 |
| `shadow.popupFilter` | `--t-shadow-popupFilter` | `md → 0 10px 28px rgba(0,0,0,0.5)` | src/components/filter-bar.tsx:318 |
| `shadow.stateWarning` | `--t-shadow-stateWarning` | `0 0 4px var(--warn)` | src/components/footer-bar.tsx:73 |
| `type.brand.family` | `--t-type-brand-family` | `ui` | Reserved sibling property; brand currently inherits this property. |
| `type.brand.size` | `--t-type-brand-size` | `xl → 13px` | src/components/sidebar.tsx:142 |
| `type.brand.weight` | `--t-type-brand-weight` | `bold → 700` | Reserved sibling property; brand currently inherits this property. |
| `type.brand.tracking` | `--t-type-brand-tracking` | `0.06em` | src/components/sidebar.tsx:142 |
| `type.brand.leading` | `--t-type-brand-leading` | `normal → 1.5` | Reserved sibling property; brand currently inherits this property. |
| `radius.confirm` | `--t-radius-confirm` | `lg → 8px` | src/components/server-row-actions.tsx:383; src/components/server-info-modal.tsx:587 |
| `radius.controlCompact` | `--t-radius-controlCompact` | `5px` | src/components/server-info-modal.tsx:477,486,495,503 |
| `radius.readinessRow` | `--t-radius-readinessRow` | `5px` | src/components/server-info-modal.tsx:533 |
| `color.onSuccess` | `--t-color-onSuccess` | `#10131a` | src/components/server-info-modal.tsx:354 |
| `shadow.confirm` | `--t-shadow-confirm` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | src/components/server-row-actions.tsx:383; src/components/server-info-modal.tsx:587 |
| `shadow.readinessWarning` | `--t-shadow-readinessWarning` | `0 0 5px rgba(193,154,85,0.6)` | src/components/server-info-modal.tsx:310 |
| `shadow.readinessSuccess` | `--t-shadow-readinessSuccess` | `0 0 5px rgba(77,154,117,0.6)` | src/components/server-info-modal.tsx:311 |

## Package 2.4a: Mods, Settings, and Update

The five migrated components use explicit property utilities for font sizes, radii (including split-button corners), shadows, and explicit transition durations. Layout dimensions and existing palette utilities remain unchanged. The Mods inspector close button now shares `color.scrim` with modal backdrops, as required by the token migration; its former `rgba(10,12,16,0.7)` background becomes `rgba(5,8,13,0.7)`.

| Role or scale | CSS variable | Default | Usage |
|---|---|---|---|
| `radius.modalLarge` | `--t-radius-modalLarge` | `12px` | Mod filter and Update dialogs |
| `shadow.statusDot` | `--t-shadow-statusDot` | `0 0 4px currentColor` | Mods ready/update status dots |
| `shadow.update` | `--t-shadow-update` | `0 25px 50px -12px rgb(0 0 0 / 0.5)` | Update dialog; preserves its former black/50 shadow |
| `type.compactMicro.size` | `--t-type-compactMicro-size` | `8.5px` | Mod filter preview tags |
| `type.compactCaption.size` | `--t-type-compactCaption-size` | `9.5px` | Mod filter mode controls and preview link |
| `type.compactBody.size` | `--t-type-compactBody-size` | `10.5px` | Mods update notice; mod filter states, preview description, and actions |
| `type.compactHeading.size` | `--t-type-compactHeading-size` | `13.5px` | Mod filter preview title |
| `scales.type.size.xl` | `--t-type-size-xl` | `13px` | Mods inspector title and mod filter heading |
| `scales.shadow.xl` | `--t-shadow-xl` | `0 24px 60px rgba(0,0,0,0.6)` | Mod filter dialog |
| `radius.input`, `control`, `controlCompact`, `popup`, `row`, `panel`, `chip`, `badge`, `thumb`, `confirm` | `--t-radius-{role}` | Existing defaults | Settings input/panel; Mods and mod filter controls, rows, tags, thumbnails, menus, and confirmation |
| `type.micro`, `caption`, `label`, `body`, `subheading` | `--t-type-{role}-size` | Existing defaults | Text throughout all five components, preserving 8/9/10/11/12px sizes |
| `shadow.glow`, `popup`, `drawer`, `confirm` | `--t-shadow-{role}` | Existing defaults | Mods selection, popups, inspector, confirmation; mod filter actions |
| `motion.hover.duration`, `motion.expand.duration` | `--t-motion-{role}-duration` | `150ms`, `200ms` | Explicit control transitions, Mods inspector clearance, Settings position/chevron |
| `color.onAccent`, `onDanger`, `scrim` | `--t-color-{role}` | Existing defaults | Mods solid controls, destructive confirmation, inspector close button; mod filter backdrop |

The four new compact type roles retain the standard sibling defaults (`family: ui`, `weight: normal`, `tracking: none`, `leading: normal`); consumers currently bind only size. TypeScript and Rust define identical defaults for all seven added roles.

## Package 2.4b: Themes page and customizer

The customizer and all eight Themes page components bind font sizes, radii, shadows, explicit transition durations, and solid-button contrast to tokens. Layout dimensions, palette previews, and inherited typography remain unchanged. The developer inspector retains its diagnostic pink palette as equivalent RGB colors, independent of the theme being inspected.

| Role or scale | CSS variable | Default | Usage |
|---|---|---|---|
| `type.compactSubheading.size` | `--t-type-compactSubheading-size` | `11.5px` | Export dialog text inputs |
| `type.compactTitle.size` | `--t-type-compactTitle-size` | `12.5px` | Import dialog package name |
| `shadow.inspector` | `--t-shadow-inspector` | `0 8px 24px rgba(0,0,0,0.5)` | Developer inspector badge; preserves its stronger shadow than ordinary popups |
| `type.micro`, `caption`, `compactCaption`, `label`, `compactBody`, `body`, `subheading`, `compactHeading` | `--t-type-{role}-size` | Existing defaults | Text throughout the customizer, dialogs, cards, pagination, settings form, and Themes section |
| `scales.type.size.xl` | `--t-type-size-xl` | `13px` | Export dialog heading |
| `radius.controlCompact`, `control`, `popup`, `card`, `modal`, `modalLarge`, `badge`, `chip`, `track` | `--t-radius-{role}` | Existing defaults | Controls, sections, dialogs, inspector badges, and swatches |
| `radius.thumb` | `--t-radius-thumb` | `7px` | Theme card preview top corners |
| `shadow.glow`, `popup`, `popupFilter`, `modal`, `confirm`; `scales.shadow.xl` | `--t-shadow-{role}`; `--t-shadow-xl` | Existing defaults | Accent controls, card menu, customizer menu, import dialog, deletion confirmation, export dialog |
| `motion.hover.duration` | `--t-motion-hover-duration` | `150ms` | Customizer switch/dropdown and dialog controls |
| `color.onAccent`, `onDanger` | `--t-color-{role}` | Existing defaults | Customizer switch knob and Save, export/import actions, destructive confirmation |

Both new compact type roles retain standard sibling defaults (`family: ui`, `weight: normal`, `tracking: none`, `leading: normal`); consumers bind only size. TypeScript and Rust define identical defaults for all three added roles.

## Migration boundaries

Do not apply one role indiscriminately to differently styled consumers. Existing differences include 10px versus 12px modals, 7px versus 8px popups, server versus Mods row padding and typography, 1.5px checkbox borders, and literal directional drawer shadows. Preserve those differences with named variants in the consumer-refactor packages and update this map and SPEC §4.4 together.

## Retained semantic palette call sites

These existing utilities remain bound to the live palette, including their hover and conditional uses. Legacy font utilities remain bound to `--font-data`; inherited UI text retains `--font-ui`.

| Utility | Call Sites |
|---|---|
| `accent-accent` | src/components/filter-bar.tsx:722 |
| `bg-accent` | src/App.tsx:813; src/components/footer-bar.tsx:134 |
| `bg-accent-soft` | src/App.tsx:801; src/components/sidebar.tsx:111,169,197,198; src/components/footer-bar.tsx:66; src/components/filter-bar.tsx:92,108,124,140,169,342,398 |
| `bg-bg` | src/App.tsx:789 |
| `bg-danger` | src/components/window-controls.tsx:62 |
| `bg-line` | src/components/footer-bar.tsx:132,192; src/components/filter-bar.tsx:365,722 |
| `bg-success` | src/components/footer-bar.tsx:73 |
| `bg-surface` | src/components/sidebar.tsx:226,227; src/components/window-controls.tsx:75,89; src/components/footer-bar.tsx:181; src/components/filter-bar.tsx:253,341,357 |
| `bg-surface2` | src/App.tsx:856; src/components/sidebar.tsx:110,168,197,198; src/components/window-controls.tsx:44,53; src/components/filter-bar.tsx:93,109,125,141,151,168,299,318,397 |
| `bg-warn` | src/components/footer-bar.tsx:73 |
| `bg-warn-soft` | src/App.tsx:843; src/components/footer-bar.tsx:67 |
| `border-accent-line` | src/App.tsx:801; src/components/filter-bar.tsx:92,108,124,140,169,397,398 |
| `border-danger` | src/App.tsx:856 |
| `border-line` | src/App.tsx:789; src/components/sidebar.tsx:127,159,197,198,226,227; src/components/window-controls.tsx:75,89; src/components/footer-bar.tsx:181; src/components/filter-bar.tsx:93,109,125,141,151,168,253,299,318,397 |
| `border-success` | src/components/footer-bar.tsx:66 |
| `border-warn` | src/App.tsx:843; src/components/footer-bar.tsx:67 |
| `text-accent` | src/App.tsx:802; src/components/sidebar.tsx:111,142,169,197,198; src/components/filter-bar.tsx:92,108,124,140,169,342,398,402 |
| `text-bg` | src/App.tsx:813 |
| `text-danger` | src/App.tsx:857; src/components/filter-bar.tsx:547 |
| `text-ink` | src/App.tsx:805,819,847,860,863; src/components/sidebar.tsx:110,168; src/components/window-controls.tsx:44,53,62; src/components/footer-bar.tsx:162; src/components/filter-bar.tsx:93,109,125,141,151,308,341,357,397 |
| `text-line` | src/components/footer-bar.tsx:91,100,117 |
| `text-muted` | src/App.tsx:819,863; src/components/sidebar.tsx:110,168,197,198; src/components/window-controls.tsx:44,53,62; src/components/footer-bar.tsx:85; src/components/filter-bar.tsx:93,109,125,141,151,168,301,308,345,357,397,405,487,548,636,708 |
| `text-muted2` | src/components/footer-bar.tsx:88,93,109,119,129,149,162; src/components/filter-bar.tsx:341,402,710,724 |
| `text-success` | src/components/footer-bar.tsx:66; src/components/filter-bar.tsx:546 |
| `text-warn` | src/App.tsx:844; src/components/footer-bar.tsx:67 |
