---
id: where-things-live
title: Where Things Live (and What Isn't in the Repo)
type: knowledge
stability: stable
summary: >
  Repo layout, the tetra/dayz naming split, and — importantly — the two
  planning documents that are gitignored, so a fresh clone does not conclude
  they don't exist.
---

# Where Things Live

## The naming split

The **repository** is `dayz-launcher`. The **product and binary** are Tetra
Launcher / `tetra-launcher.exe`, and every crate is `tetra-*`. Both names are
correct; they refer to different things. Local database files are `tetra.db*`.

## Layout

| Path | What |
|---|---|
| `crates/tetra-core` | Shared domain types |
| `crates/tetra-net` | Network / query layer |
| `crates/tetra-registry` | Server registry |
| `crates/tetra-steam` | Steam integration |
| `crates/tetra-launch` | Launch / process control |
| `src-tauri/` | Tauri shell, commands, `tauri.conf.json` |
| `src/` | React + Vite frontend |
| `.github/workflows/` | `check.yml`, `release.yml` |

## Not in the repository — read this before concluding something is missing

Two planning documents are **deliberately gitignored** and exist only on
James's machine:

| File | What it is |
|---|---|
| `progress.md` | **The canonical feature backlog and changelog.** Three sections: "Recently Fixed" (dated), "Completed" (stable features), "Pending Tasks" (High/Medium/Low backlog) |
| `implementation_plan.md` | The original architecture doc. Mostly stale and historical — not a running wishlist |

`progress.md` is the answer to "what features were requested" or "what's left to
do". **If you are working from a fresh clone, you do not have it** — ask rather
than assuming the backlog is empty or reconstructing it from git log.

When James confirms a fix works, the convention is to *move* the bullet from
Pending Tasks into a dated "Recently Fixed" entry, keeping the diagnostic
context (root-cause theories, evidence) rather than deleting it — so that if the
issue resurfaces, the previous investigation is still there.

`CHANGELOG.md` (tracked, user-facing) is distinct from `progress.md`
(gitignored, engineering detail). Both are kept current; they are not
duplicates of each other.

## Version numbers live in two files

`package.json` and `src-tauri/tauri.conf.json`, kept in lockstep. Both must be
bumped together — see the [`release`](../workflows/release.md) workflow.
