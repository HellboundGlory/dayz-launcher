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
| RepoOS | `npm run repoos:check` | `.ai/` is valid and `CLAUDE.md` hasn't drifted |

Run the first four locally before pushing — see [`check`](../workflows/check.md).
There is nothing CI can tell you that this doesn't.

The RepoOS job is the exception — it only matters once you have touched `.ai/`:

```bash
npm run repoos:generate    # after editing .ai/ — rewrites CLAUDE.md
npm run repoos:check       # what CI runs; writes nothing
```

If it fails, **regenerate**. Never hand-edit `CLAUDE.md` to make it pass — that
recreates the two-sources-of-truth problem RepoOS exists to remove, and the next
regeneration silently discards whatever you wrote.

The CLI is fetched on first use at the tag in `.repoos-version` and cached in
your user cache directory — outside the repository, and shared across projects —
so later runs need no network.

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

The workspace compiles on both Windows and Linux. `winreg` and
`window-vibrancy` are Windows-only concerns (Steam registry discovery, the
`dzsa://` protocol handler, and acrylic compositing) and are gated behind
`[target.'cfg(windows)'.dependencies]` / `cfg(windows)`, with Linux
equivalents where one exists (`libraryfolders.vdf` and an XDG `.desktop`
entry for Steam discovery). CI runs the Rust checks on **both**
`windows-latest` (`rust` job) and `ubuntu-latest` (`rust-linux` job) for
exactly this reason — the launcher ships a Windows installer and a Linux
AppImage, and a Windows-only change must not silently break the Linux build.
