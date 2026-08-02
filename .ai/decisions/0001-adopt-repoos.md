---
id: adr-0001-adopt-repoos
title: Adopt RepoOS for repository-local AI knowledge
type: decision
stability: stable
summary: >
  Moved five machine-local AI memories into a committed .ai/ layer so the build
  gotchas and the release hard-stop travel with the repository.
---

# 0001 — Adopt RepoOS for repository-local AI knowledge

## Status

Accepted — 2026-08-02

## Context

Everything an AI assistant had learned about this project lived in
`~/.claude/projects/c--Users-James-Downloads-Projects-dayz-launcher/` — a
per-user, per-machine directory outside the repository. Five curated memory
files plus ~26 MB of session transcripts.

None of it travelled. A fresh clone, a different machine, or a different AI tool
started with nothing, despite the knowledge being both hard-won and specific:

- `npx tauri build --debug` vs `cargo build` writing the same path, where the
  wrong one fails only at runtime in the window
- Windows locking the running EXE, so builds fail until it's closed
- Version numbers living in two files that must stay in lockstep
- **That pushing a version tag publishes irreversibly** — learned by publishing
  v1.0.1 prematurely on 2026-08-01, which forced the next fixes to become v1.0.2

The last one is the clearest case: an expensive mistake whose lesson existed
only in a machine-local file.

## Decision

Adopt RepoOS (spec `1.2.0`): a committed `.ai/` directory plus a root
`AGENTS.md`. The five external memories were extracted into workflows,
knowledge, policy, and one lesson. `CLAUDE.md` is **generated** from that layer,
not hand-maintained.

The session transcripts were deliberately left where they are — they are a log,
not knowledge.

## Consequences

**Gained**

- The build gotchas and the release hard-stop now travel with the repository
- Changes to what agents are told are reviewable diffs
- Any AI tool gets the same context, not just the one that learned it

**Cost**

- The layer needs maintenance. Stale documentation is worse than none because
  it gets trusted.
- `CLAUDE.md` must be regenerated rather than edited.

**Deliberately not moved**

- `progress.md` and `implementation_plan.md` stay gitignored. They remain local
  engineering notes; `where-things-live` documents that they exist and are
  absent from a clone, so nobody concludes there is no backlog.
- Signing key backup locations are recorded nowhere in this repo. It is public.

## Alternatives considered

- **Keep using per-tool memory.** Rejected: doesn't survive a machine change,
  can't be reviewed, and is invisible to any other tool.
- **Hand-write `CLAUDE.md`.** Rejected: it drifts from `.cursorrules` and any
  future vendor file, and nothing is authoritative.
- **Commit `progress.md`.** Rejected for now — 1,236 lines of engineering
  detail including root-cause theories, in a public repo, in every diff.
