# One registry file shared by the frontend and backend

v1 kept its slot registry in TypeScript and a hand-maintained copy in Rust, which had to be updated together every time a slot changed. v2's element registry is a single JSON file that the frontend imports and the backend compiles in, so both sides always agree on element ids, contexts, required rules, options, states and the launcher version each element was introduced in.

Settled in the 2026-09-15 design session: Q21.

## Status
accepted
