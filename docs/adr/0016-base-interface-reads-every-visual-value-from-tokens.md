# The base interface reads every visual value from tokens

The base interface hardcodes corner radii (138 `rounded-[Npx]` values and 26 named radius classes), several colours and pixel sizes, while the existing spacing and radius tokens are read by nothing — so v1 themes could only change them by overriding CSS. v2 refactors all of it onto two token layers: scales (radius, space, type, border, shadow, motion) and the roles components actually use (such as `radius.row` or `color.onAccent`). Every default equals today's value, and a visual regression check proves Neutral stays pixel-identical.

Settled in the 2026-09-15 design session: Q10, Q31, Q55.

## Status
accepted
