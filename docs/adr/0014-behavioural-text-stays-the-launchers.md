# Behavioural text stays the launcher's

Themes may add plain theme text for decoration (at most 120 characters, no markup, links or data) and may relabel optional elements (at most 40 characters). Required elements can't take free text; they offer launcher-provided wording variants instead — Join can be worded as "Join" or "Fix and join", and the launcher picks the words for the current state. A theme can match a layout like the reference but can never make Join, Close or a notice say something misleading. For the same reason, CSS may only generate empty `content`.

Letting themes relabel everything was rejected because the text on an action is part of what the action promises.

Settled in the 2026-09-15 design session: Q8, Q32, Q47.

## Status
accepted
