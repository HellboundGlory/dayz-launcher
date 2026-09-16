# Required elements are enforced by validation and a visibility check

Validation can prove a required element is placed, but CSS can still hide it, shrink it, cover it or move it off-window. The launcher therefore also runs a visibility check whenever the layout itself changes — theme activation, hot reload, window resize, opening a view, modal or popup, switching variant, collapsing a region or changing tab, but never on data updates — and treats a failure like invalid layout. Inside lists only the selected and keyboard-focused entries are checked, which keeps the cost bounded.

A CSS rule forbidding hiding properties on required elements was rejected: it would ban legitimate styling, such as revealing an action on hover, that the visibility check already judges correctly.

## Consequences

- Settings controls may sit in closed sections; validation proves they are placed, and the visibility check measures them only while their section is open.
- A collapsed region must still place every required element it holds, and a required element inside tabs must sit in the default pane.
- A filter or sort popup must contain its list of options, and a popup opened into a region or inline must offer a way to close it. Action menus have no required items.

Settled in the 2026-09-15 design session: Q24, Q25, Q44, Q45, Q56, Q71, Q73.

## Status
accepted
