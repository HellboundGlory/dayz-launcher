# Tetra Launcher

Tauri desktop launcher for browsing and joining DayZ servers. Rust workspace
behind a React + Vite frontend.

> The repo is `dayz-launcher`; the product and binary are Tetra Launcher /
> `tetra-launcher.exe`. Both names are correct — see
> [`where-things-live`](.ai/knowledge/where-things-live.md).
>
> This repository uses **RepoOS**. Structured knowledge lives in [`.ai/`](.ai/).
> Spec: `1.2.0`.

## Start here

| If you need… | Read |
|---|---|
| How to build, check, release | [`.ai/workflows/`](.ai/workflows/) |
| Repo layout and what's *not* committed | [`where-things-live`](.ai/knowledge/where-things-live.md) |
| CI, signing, auto-update | [`release-pipeline`](.ai/knowledge/release-pipeline.md) |
| What agents may and may not do | [`agent-policy`](.ai/meta/agent-policy.md) |

## Working here

- **Build with `npx tauri build --debug`, never plain `cargo build`.** Both
  write `target/debug/tetra-launcher.exe`; the wrong one silently produces a
  launcher that opens on "localhost refused to connect".
- **Default to debug.** Don't run a release build just to check something
  compiles — `cargo check` / `clippy` / `test` / `tsc --noEmit` write nothing
  and take seconds rather than a minute.
- **Stop before pushing a version tag.** Naming a version is not permission to
  publish it. That push triggers CI and is irreversible.
- Closing a running launcher before a build is expected — no need to ask.
- Version numbers live in **two** files and move together: `package.json` and
  `src-tauri/tauri.conf.json`.
- Clippy warnings are CI errors (`-D warnings`).
- `progress.md` is the feature backlog and is **gitignored** — it isn't in a
  fresh clone. Ask rather than assuming there's no backlog.

## Common tasks

| Task | Workflow |
|---|---|
| Build a testable exe | [`build-debug.md`](.ai/workflows/build-debug.md) |
| Verify without building | [`check.md`](.ai/workflows/check.md) |
| Cut a release | [`release.md`](.ai/workflows/release.md) ⚠ |
