---
id: build-debug
title: Build the Debug Executable
type: workflow
stability: stable
command: build-debug
triggers:
  - build
  - build debug
  - build the launcher
  - make a build
  - rebuild
  - build so I can test
destructive: false
idempotent: true
expected_duration: 1m
applies_to:
  - "crates/**"
  - "src-tauri/**"
  - "src/**"
related: [release, check, where-things-live]
summary: >
  Build the testable exe with `npx tauri build --debug`. A plain `cargo build`
  writes to the same path and silently produces a binary that opens on
  "localhost refused to connect" — the failure only shows at runtime.
---

# Build the Debug Executable

> This is the default build for all in-progress work. Do **not** run a release
> build just to check that something compiles — see [`release.md`](release.md).

## Prerequisites

- Dependencies installed (`npm ci`)
- The launcher must not be running (step 1 handles this)

## Steps

1. Close the running launcher if there is one. Windows locks the running EXE, so
   the build fails with "Access is denied" while it is open. **This does not
   need asking each time** — it is part of the procedure:

   ```powershell
   Get-Process -Name tetra-launcher -ErrorAction SilentlyContinue | Stop-Process -Force
   ```

   Mention in your report that the launcher was closed.

2. Build the debug executable:

   ```bash
   npx tauri build --debug
   ```

   **Use this command and not `cargo build`.** Both write to
   `target/debug/tetra-launcher.exe`. A plain `cargo build -p tetra-launcher`
   produces a binary that resolves `devUrl` instead of `frontendDist`, so the
   launcher opens on "localhost:5173 refused to connect". The bad binary
   silently replaces the good one and nothing fails until you open the window.

## Validation

- `target/debug/tetra-launcher.exe` exists and its timestamp is from this build
- Launching it shows the actual UI — **not** a "localhost refused to connect"
  page. If you see that page, step 2 was run as `cargo build`; re-run it
  correctly.

## Expected Outputs

- `target/debug/tetra-launcher.exe` — the testable debug build

---

## Verification without building

These touch nothing and are safe at any time — prefer them when you only need
to know whether the code is correct:

```bash
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npx tsc --noEmit
```

For live frontend iteration, `npx tauri dev` is faster than rebuilding.
