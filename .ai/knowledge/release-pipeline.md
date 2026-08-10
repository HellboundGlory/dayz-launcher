---
id: release-pipeline
title: Release Pipeline and Auto-Update
type: knowledge
stability: stable
applies_to:
  - ".github/workflows/*.yml"
  - "src-tauri/tauri.conf.json"
related: [release, tag-push-is-the-point-of-no-return]
summary: >
  Releases are signed and tag-triggered. Installed copies auto-update from
  latest.json; portable copies are notify-only. Losing the signing key would
  permanently break updates for every installed copy.
---

# Release Pipeline and Auto-Update

## Two CI workflows

| Workflow | Trigger | Does |
|---|---|---|
| `check.yml` | every push and PR | three independent jobs — see below |
| `release.yml` | **pushing a `vX.Y.Z` tag only** | builds, signs, publishes Windows (NSIS installer + portable zip) and Linux (AppImage, .deb, .rpm) artifacts + `latest.json` |

`check.yml` jobs:

| Job | Runner | Does |
|---|---|---|
| `rust` | `windows-latest` | `cargo fmt --check`, `clippy -D warnings`, `cargo test` (Windows-only paths) |
| `rust-linux` | `ubuntu-latest` | same on Linux, so the Linux/AppImage build cannot silently break |
| `frontend` | `ubuntu-latest` | `npm ci`, `tsc --noEmit` |
| `repoos` | `ubuntu-latest` | validates `.ai/`, and fails if `CLAUDE.md` has drifted from it |

The `repoos` job clones the RepoOS CLI (zero-dependency, so the clone is the
whole install) and runs two checks. The second one — `generate --check` — is the
only place in this repository where documentation drift blocks a build, and it
earns that because the fix is always one command.

**That clone is pinned**, and the tag lives in **`.repoos-version`** at the repo
root — that file is the only place the version appears. Both `check.yml` and
`scripts/repoos.mjs` read it, so a local run and CI cannot end up on different
CLI versions.

Upgrading is a deliberate two-part change that belongs in **one commit**: edit
`.repoos-version`, then run `npm run repoos:generate`. They travel together
because `generate --check` compares `CLAUDE.md` against whatever the *fetched*
CLI produces — a newer CLI beside an unregenerated `CLAUDE.md` fails the build,
so splitting them across two commits leaves `main` red in between.

`release.yml` does not run on ordinary commits. Pushing the tag is the only
thing that publishes — which is why that push is gated (see
[`release`](../workflows/release.md)).

Rust is checked on both `windows-latest` and `ubuntu-latest`. The workspace
pulls in `winreg` and `window-vibrancy` which are Windows-only dependencies, so
the two are gated to `cfg(windows)`; a Linux runner compiles the rest. This
mirrors the release: `release.yml` produces a Windows NSIS install on
`windows-latest` and an AppImage + .deb + .rpm on `ubuntu-latest` from the
same tag.

## Auto-update

`tauri-plugin-updater`, wired 2026-08-01. The update endpoint is:

```
https://github.com/HellboundGlory/dayz-launcher/releases/latest/download/latest.json
```

The frontend gates auto-install behind the `is_installed_copy` Rust command.
Because the portable and installed builds are the same executable, this is a
**location heuristic** rather than a reliable flag:

- **Installed copies** — auto-install permitted
- **Portable copies** — notify-only with a link, never a silent install

Silently replacing a portable exe sitting in someone's Downloads folder is not
acceptable behaviour, hence the split.

## Code signing

Releases are signed, and the updater verifies signatures. Practical
consequences:

- Two GitHub Actions secrets drive it: `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. They are write-only from the repo's
  perspective.
- The public key in `tauri.conf.json` is the counterpart to the signing key and
  was byte-verified against it on 2026-08-01.
- **The private key never enters this repository.** Never commit it, never
  print it, never move it around unattended.
- Losing the key permanently breaks updates for **every already-installed
  copy** — they will reject anything signed with a different key. It is backed
  up outside this repo; the locations are deliberately not recorded here.

## Release history

v0.1.0 → v0.2.0 → v1.0.0 (engineering audit) → v1.1.0 → … → v1.9.0 (adds the
`.rpm`), all on or after 2026-08-01. The asset list has grown over time (the
`.deb` in v1.8.0, the `.rpm` in v1.9.0) — see the `check.yml`/`release.yml`
table above for what a release ships today rather than assuming a fixed
count. The update loop is proven end to end: a running installed v0.1.0
detected and installed v0.2.0, user-confirmed.

## Changelog publishing is automatic

`tauri-action` has no `releaseBody` configured, so left alone the GitHub
release body would be an auto-generated commit list rather than
`CHANGELOG.md`. As of v1.9.0, the last step of `release-linux` in
`release.yml` extracts this version's `## v<version>` section from
`CHANGELOG.md` and pushes it to **both** `latest.json`'s `notes` (what the
in-app update dialog reads) and the GitHub release body itself (`gh release
edit`). There is no manual step anymore — previously this required running
`gh release edit v<version> --notes-file <file>` by hand after every tag,
which was easy to forget.

That step **fails the whole build** if `CHANGELOG.md` has no section for the
tag being released, specifically so a forgotten changelog entry is caught
here rather than shipping a release with empty notes in two places.

## Crate versions are inherited, not independent

`crates/*` and `src-tauri` all declare `version.workspace = true` rather than
their own `version`, resolving to `[workspace.package].version` in the root
`Cargo.toml` — the same mechanism already used for `edition`/`rust-version`/
`license`. None of these crates are published to crates.io (no `publish`
field is set, and nothing in CI runs `cargo publish`); every internal
dependency between them is a bare `path = "..."` with no `version =`
requirement, so Cargo never checks their version numbers for anything. Before
v1.9.0 each crate carried its own version, bumped ad hoc (or not at all) —
`tetra-net`, for instance, sat at `0.1.0` across several app releases.
Inheriting from the workspace root removes the drift entirely: bumping the
one root field for a release moves every crate in lockstep, with no separate
step to remember and nothing to forget.
