# Theme settings reach CSS only through custom properties

Theme setting values are substituted into tokens and layout files only where a literal value is allowed, and reach CSS only as generated `--setting-<id>` custom properties plus published states on the window root — never by substituting text into the stylesheet. Text substitution into CSS was rejected because a setting value could then smuggle selectors or rules past CSS validation.

## Consequences

Boolean and choice settings can hide layout nodes, so every combination of them (at most 64) is validated against the required-element rules.

Settled in the 2026-09-15 design session: Q33.

## Status
accepted
