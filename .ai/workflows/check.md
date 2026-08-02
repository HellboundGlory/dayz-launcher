---
id: check
title: Run the Checks
type: workflow
stability: stable
command: check
triggers:
  - check
  - test
  - run tests
  - lint
  - does this compile
  - verify
destructive: false
idempotent: true
expected_duration: 2m
related: [build-debug]
summary: >
  Mirrors CI (check.yml) exactly. None of these produce a binary, so they never
  clobber your debug build — prefer them over building when you only need to
  know whether the code is correct.
---

# Run the Checks

These are the same four steps `check.yml` runs on every push and PR. Running
them locally first means CI tells you nothing new.

**None of them write an executable**, so they cannot clobber the debug build
from [`build-debug`](build-debug.md). Reach for these first.

## Prerequisites

- Dependencies installed (`npm ci`)

## Steps

1. Formatting — CI fails on any diff:

   ```bash
   cargo fmt --all --check
   ```

2. Lints. **Warnings are errors in CI**, so treat them as errors here:

   ```bash
   cargo clippy --workspace --all-targets -- -D warnings
   ```

3. Tests across the whole workspace:

   ```bash
   cargo test --workspace
   ```

4. Frontend typecheck:

   ```bash
   npx tsc --noEmit
   ```

## Validation

- All four commands exit zero
- No clippy warnings — `-D warnings` means a warning is a CI failure

## Expected Outputs

- Nothing written. These are read-only checks by design.

---

**Note on CI:** `check.yml` runs Rust on `windows-latest` because the workspace
needs `winreg` and `window-vibrancy`. A Linux runner cannot compile it — this
is not a CI misconfiguration to be "fixed".
