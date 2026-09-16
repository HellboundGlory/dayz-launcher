# Layout validation runs once, in the backend

Import, seeding, startup loading, fallback and Dev Mode hot reload all need the same verdict on whether a theme's files are valid. There is exactly one validator, written in Rust against the shared registry (ADR-0007). It runs before an imported package reaches the themes folder, when a bundled theme is seeded, when the frontend asks for a theme, and on every hot reload. The frontend renders only files the backend has accepted. The visibility check is the one rule that stays in the frontend, because it measures the live interface.

## Considered Options

- **A TypeScript validator run before confirming an import** was rejected: a crafted package could reach disk by skipping the frontend, and startup loading would trust whatever was on disk.
- **Both, kept in step by shared test fixtures** was rejected: it recreates the two-copy maintenance that ADR-0007 removed.

## Consequences

Every validation result carries the file, a JSON pointer into it and a stable rule id, so Dev Mode can show results without re-deriving anything. Hot reload validates over IPC, and the existing watch debounce absorbs the round trip.

Settled in the 2026-09-15 design session: Q68.

## Status
accepted
