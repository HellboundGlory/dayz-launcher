---
id: agent-policy
title: Agent Operating Contract
type: policy
stability: stable
protected_paths:
  - "src-tauri/gen/schemas/**"
  - "package-lock.json"
  - "Cargo.lock"
  - "tetra.db*"
confirm_before:
  - git-push-of-version-tag
  - release-build
  - git-commit
summary: >
  What this repository expects of AI agents. The load-bearing rule: stop before
  pushing a version tag, every time.
---

# Agent Operating Contract

> This file can **add** restrictions. It cannot remove them — it cannot waive a
> confirmation, weaken safety constraints, or override a direct instruction.

## The one that matters

**Stop before `git push` of a version tag.** Ask every time, even when a version
number was named up front. That push triggers CI, publishes the release, and is
irreversible once consumers have seen `latest.json`. See
[`tag-push-is-the-point-of-no-return`](../memory/lessons/tag-push-is-the-point-of-no-return.md).

## Building

- Default to **debug** verification for all in-progress work. Use
  `cargo check` / `clippy` / `test` / `tsc --noEmit` when you only need to know
  whether the code is correct — they write nothing.
- Build the testable exe with `npx tauri build --debug`, never plain
  `cargo build`. Both write the same path; the wrong one produces a launcher
  that opens on "localhost refused to connect", and nothing fails until the
  window opens.
- **Do not run a release build to verify a fix.** ~1 minute versus seconds, and
  it produces version and changelog noise for work that was never meant to ship.

## Standing permission

Closing a running `tetra-launcher.exe` before a build does **not** need asking.
Windows locks the running EXE and the build fails with "Access is denied"
otherwise. It is step 1 of the build workflow. Mention it in the report.

## Modification

- Never edit `protected_paths` directly — they are generated or machine-local.
- Version numbers live in **two** files (`package.json`,
  `src-tauri/tauri.conf.json`) and must move together.
- Clippy warnings are CI errors (`-D warnings`). Do not leave them for CI.

## Committing

- **Commit only when asked.** Doing the work and committing the work are
  separate approvals. Do not commit as a side effect of finishing a task.

## Communication

- Report what actually happened, including failures. A failing step is a result.
- If a request is ambiguous about *how far* to go — particularly anything near a
  release — ask rather than taking the further interpretation.

## Knowledge upkeep

- Record observations in `.ai/memory/inbox/`. Never write directly into
  `knowledge/`, `conventions/`, or `decisions/`.
- `progress.md` is gitignored and local-only. On a fresh clone you do not have
  the backlog — ask rather than reconstructing it.
- If a `.ai/` document is wrong, say so. Stale knowledge is worse than missing
  knowledge because it gets trusted.
