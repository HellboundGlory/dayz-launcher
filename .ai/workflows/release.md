---
id: release
title: Cut a Release
type: workflow
stability: stable
command: release
triggers:
  - release
  - cut a release
  - publish a release
  - ship it
  - push a version
destructive: true
idempotent: false
expected_duration: 10m
inputs:
  - name: version
    required: true
    description: Semantic version, e.g. 1.1.1. Must not reuse a published tag.
applies_to:
  - "package.json"
  - "src-tauri/tauri.conf.json"
  - "CHANGELOG.md"
  - ".github/workflows/release.yml"
related: [build-debug, release-pipeline, tag-push-is-the-point-of-no-return]
summary: >
  Version bump in two files, changelog, tag, push. Pushing the tag is what
  triggers CI to publish — it is irreversible once consumers have seen
  latest.json. Never push the tag without explicit go-ahead.
---

# Cut a Release

> `destructive: true`. **Only run this when James has explicitly said he is
> ready to release.** Naming a version number is not authorisation to publish
> it — see [`## The hard stop`](#the-hard-stop) below.

## Prerequisites

- James has explicitly signalled a release ("let's push a release", "I'm
  ready", or equivalent). A version number mentioned in passing is **not** that
  signal.
- Working tree clean, on `main`
- `check.yml` green — run the [`check`](check.md) workflow locally first
- The change has actually been tested with a debug build ([`build-debug`](build-debug.md))

## Steps

1. Choose the version. It must not reuse a tag that has ever been pushed —
   published tags are permanent because consumers may already have seen them.

2. Bump the version in **both** files, kept in lockstep:

   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`

   They must match. A mismatch produces a release whose installer and updater
   metadata disagree.

3. Write the `CHANGELOG.md` entry for this version. This is user-facing — keep
   it in the register a user reads, not engineering shorthand.

4. Commit the bump and changelog. **Commit only when asked**; do not commit as
   a side effect of doing the work.

5. **STOP HERE and ask for the go-ahead.** See below.

6. Only after explicit approval, tag and push:

   ```bash
   git tag v<version>
   git push origin v<version>
   ```

7. CI (`release.yml`) takes over: it builds, signs, and publishes the installer,
   `.sig`, portable zip, and `latest.json`.

8. Set the release notes manually. `tauri-action` has no `releaseBody`
   configured, so the body is auto-generated and needs replacing with the
   matching `CHANGELOG.md` section:

   ```bash
   gh release edit v<version> --notes-file <file>
   ```

## The hard stop

**Pushing the tag is the point of no return.** It triggers the GitHub Actions
release, and once `latest.json` is published, installed copies can see it.
There is no unpublish that helps — anyone who already updated has the build.

Ask for the go-ahead at step 6 **every time**, even when a version number was
named up front.

This rule exists because of a specific incident — see
[`tag-push-is-the-point-of-no-return`](../memory/lessons/tag-push-is-the-point-of-no-return.md).

## Validation

- The GitHub release exists with **all four assets**: NSIS installer, `.sig`,
  portable zip, `latest.json`
- The tag matches the version in both `package.json` and `tauri.conf.json`
- Release notes are the real changelog section, not the auto-generated body
- An installed copy detects the update (the full loop was proven end to end on
  2026-08-01: a running v0.1.0 detected and installed v0.2.0)

## Rollback

There is **no unpublish that undoes a release** — installed copies may already
have updated.

1. Do not delete the tag or the release if any time has passed. Deleting
   `latest.json` breaks the updater for clients mid-check.
2. Fix forward: bump to the next patch version and release that. This is what
   happened after the premature v1.0.1 — the next fixes shipped as v1.0.2
   rather than folding back.
3. If the bad release is actively harmful, edit the GitHub release to mark it
   as a pre-release so `latest` stops pointing at it, then ship the fix.

## Expected Outputs

- A published GitHub release at `v<version>` with four assets
- Matching version in `package.json`, `tauri.conf.json`, and the tag
- A `CHANGELOG.md` entry, mirrored into the release notes
