# Theme CSS targets a stable styling API inside cascade layers

v1 theme CSS could target any selector, including internal Tailwind classes, so any launcher refactor could break themes without warning. v2 theme CSS may only target element ids, element parts (named pieces inside an element, such as a stat's value and caption), published states and contexts, and class names the theme itself declares in its layout files — which must start with `t-` so they can never collide with a Tailwind utility. The validator refuses every other selector, `!important`, `@import` and remote resources, and there is no escape hatch for unrestricted CSS.

Launcher CSS sits in a `launcher` cascade layer and theme CSS in a later `theme` layer, so a theme wins without specificity fights. A final `guarantees` layer holds what no theme may override: the keyboard focus ring, reduced-motion handling and the hooks the visibility check relies on.

Settled in the 2026-09-15 design session: Q11, Q32, Q51, Q59, Q72.

## Status
accepted
