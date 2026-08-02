---
id: rust-and-ci
title: Rust, Frontend, and CI Expectations
type: convention
stability: stable
applies_to:
  - "crates/**"
  - "src-tauri/**"
  - "src/**"
  - ".github/workflows/check.yml"
related: [check, build-debug]
summary: >
  Clippy warnings are CI errors. Formatting is checked, not suggested. Run the
  check workflow locally so CI tells you nothing new.
---

# Rust, Frontend, and CI Expectations

## Enforced by CI — not negotiable

`check.yml` runs on every push and PR:

| Check | Command | Note |
|---|---|---|
| Format | `cargo fmt --all --check` | Fails on any diff |
| Lints | `cargo clippy --workspace --all-targets -- -D warnings` | **Warnings are errors** |
| Tests | `cargo test --workspace` | Whole workspace |
| Types | `npx tsc --noEmit` | Frontend |
| RepoOS | `repoos validate .` + `repoos generate . --check` | `.ai/` is valid and `CLAUDE.md` hasn't drifted |

Run the first four locally before pushing — see [`check`](../workflows/check.md).
There is nothing CI can tell you that this doesn't.

The RepoOS job is the exception: you only need it after editing `.ai/`, and if
it fails the fix is to regenerate rather than to change anything by hand.

**`-D warnings` means a clippy warning fails the build.** Don't leave them for
CI to find, and don't `#[allow]` them to make CI pass without saying why in the
same change.

## Workspace shape

Five crates plus the Tauri shell:

```
tetra-core      shared domain types
tetra-net       network / query
tetra-registry  server registry
tetra-steam     Steam integration
tetra-launch    launch / process control
src-tauri       Tauri shell and commands
```

Prefer putting logic in the crate that owns the concern rather than in
`src-tauri`. The shell should be thin — commands, wiring, and window management.

## Frontend

`npm run build` is `tsc --noEmit && vite build` — **frontend only**. It does not
produce the launcher. Reading `package.json` alone will mislead you here; the
real build is in [`build-debug`](../workflows/build-debug.md).

## Platform

The workspace needs `winreg` and `window-vibrancy`, so it is Windows-only to
compile. CI uses `windows-latest` for that reason. This is not a CI
misconfiguration and should not be "fixed" by moving to a Linux runner.
