---
id: tag-push-is-the-point-of-no-return
title: Naming a version is not authorisation to publish it
type: memory
confidence: high
verified: 2026-08-01
source: incident-2026-08-01-v1.0.1
related: [release, release-pipeline]
summary: >
  A version number mentioned in conversation is a description of the work, not
  permission to ship it. Pushing the tag triggers CI and is irreversible once
  consumers have seen latest.json.
---

# Naming a version is not authorisation to publish it

## What happened

On 2026-08-01 James said *"let's make a v1.0.1 for some fixes"*. That was read
as approval for the whole sequence: the work was implemented, committed, tagged,
and the tag pushed in a single pass. CI picked up the tag and published the
release.

He had meant **the work**, not the shipping.

## Why it could not be undone

The tag was already public and `latest.json` had been published, so installed
copies could see it. Unpublishing would have broken the updater for anyone
mid-check, and anyone who had already updated had the build regardless.

The next batch of fixes had to ship as **v1.0.2** rather than folding into
v1.0.1, because a published version number can never be reused.

## What to do instead

Treat the release as two separate approvals:

1. **"Make a v1.0.1"** → do the work. Implement, and commit only when asked.
2. **Pushing the tag** → a *separate* question, asked every time, even when a
   version number was named up front.

Stop before `git push origin v<version>`. That push is what triggers the
GitHub Actions release, and it is effectively irreversible.

## The general shape

This generalises beyond releases: **naming a thing is not authorising it.**
When a request describes an outcome that involves an irreversible externally
visible step, the description covers the work up to that step, not the step
itself.
