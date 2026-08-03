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
| `release.yml` | **pushing a `vX.Y.Z` tag only** | builds, signs, publishes installer + `.sig` + portable zip + `latest.json` |

`check.yml` jobs:

| Job | Runner | Does |
|---|---|---|
| `rust` | `windows-latest` | `cargo fmt --check`, `clippy -D warnings`, `cargo test` |
| `frontend` | `ubuntu-latest` | `npm ci`, `tsc --noEmit` |
| `repoos` | `ubuntu-latest` | validates `.ai/`, and fails if `CLAUDE.md` has drifted from it |

The `repoos` job clones the RepoOS CLI (zero-dependency, so the clone is the
whole install) and runs two checks. The second one — `generate --check` — is the
only place in this repository where documentation drift blocks a build, and it
earns that because the fix is always one command.

**That clone is pinned to a RepoOS tag** — `REPOOS_VERSION` in `check.yml`,
currently `v1.3.0`. Upgrading is a deliberate two-part change: bump the tag,
run `repoos generate .`, and commit both together. They belong in one commit
because `generate --check` compares `CLAUDE.md` against whatever the *fetched*
CLI produces, so a newer CLI plus an unregenerated `CLAUDE.md` fails the build
— splitting them across two commits leaves `main` red in between.

`release.yml` does not run on ordinary commits. Pushing the tag is the only
thing that publishes — which is why that push is gated (see
[`release`](../workflows/release.md)).

`check.yml` runs Rust on `windows-latest` because the workspace needs `winreg`
and `window-vibrancy`. A Linux runner cannot compile it.

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

v0.1.0 → v0.2.0 → v1.0.0 (engineering audit) → v1.1.0, all on or after
2026-08-01. Every release has shipped all four assets. The update loop is proven
end to end: a running installed v0.1.0 detected and installed v0.2.0,
user-confirmed.

## Known rough edge

`tauri-action` has **no `releaseBody` configured**, so the GitHub release body
is auto-generated and does not match `CHANGELOG.md`. Every release needs the
notes set afterwards:

```bash
gh release edit v<version> --notes-file <file>
```

This is a manual step every time. Automating it is an open improvement, not a
bug to be surprised by.
