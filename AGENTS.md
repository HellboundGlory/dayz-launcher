# Tetra Launcher

Tauri desktop launcher for browsing and joining DayZ servers. Rust workspace
behind a React + Vite frontend.

> The repo is `dayz-launcher`; the product and binary are Tetra Launcher /
> `tetra-launcher.exe`. Both names are correct.

## Start here

| If you need… | Read |
|---|---|
| Build, check, release workflows | `viking://resources/dayz-launcher/.ai/workflows/` |
| Repo layout and what's *not* committed | `viking://resources/dayz-launcher/.ai/knowledge/where-things-live.md` |
| CI, signing, auto-update | `viking://resources/dayz-launcher/.ai/knowledge/release-pipeline.md` |
| What agents may and may not do | `viking://resources/dayz-launcher/.ai/meta/agent-policy.md` |

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
- Version numbers live in **three** files and move together: `package.json`,
  `src-tauri/tauri.conf.json`, and `[workspace.package].version` in the root
  `Cargo.toml` (every crate inherits via `version.workspace = true`).
- Clippy warnings are CI errors (`-D warnings`).
- `progress.md` is the feature backlog and is **gitignored** — it isn't in a
  fresh clone. Ask rather than assuming there's no backlog.
- **Never add trailing commit-message markers** (`Co-Authored-By`,
  `Claude-Session`, or similar). Commits are attributed to the human author only.
- **Keep code comments minimal.** Only short, human-style notes where the
  "why" isn't obvious from the code itself — no essay-length rationale, audit
  narration, or bug history inline. If that context is worth keeping, it
  belongs in `.ai-notes/` (gitignored, mirrors the source tree), not the file.

## Common tasks

| Task | Workflow |
|---|---|
| Build a testable exe | `viking://resources/dayz-launcher/.ai/workflows/build-debug.md` |
| Verify without building | `viking://resources/dayz-launcher/.ai/workflows/check.md` |
| Cut a release | `viking://resources/dayz-launcher/.ai/workflows/release.md` ⚠ |

---

## Memory — OpenViking (PRIMARY)

**OpenViking** (`viking://`) is the primary long-term context database. Run locally at
`http://127.0.0.1:1933/mcp` and registered in `~/.omp/agent/mcp.json`. **ALWAYS use the
OpenViking MCP for memory** — recall before answering, retain after learning.

- Recall: `find` / `search` (semantic; `search mode=context` = injection-ready)
- Retain: `write` / `remember`; read/browse: `read` / `list` / `tree` / `glob`; edit: `edit`
- This project's docs: `viking://resources/dayz-launcher/` (AGENTS/README, `.ai/` incl. workflows/knowledge/memory, `progress.md`, Claude memory)
- Durable memories: `viking://user/default/memories/dayz-launcher/`
- Use canonical `viking://user/default/...` (the `viking://~/` alias is rejected by `write`).

omp `memory.backend` stays `mnemopi` for auto-injected session history (dual-run);
OpenViking is the store you actively search and write to.
