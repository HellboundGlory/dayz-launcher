---
title: The repoos CI job only works while its upstream repo is public
type: memory
source: agent:claude-opus-5/session-2026-08-03
applies_to:
  - ".github/workflows/check.yml"
related: [release-pipeline, rust-and-ci]
summary: >
  check.yml's repoos job clones the RepoOS CLI over unauthenticated HTTPS. That
  works only because the upstream repository is public — GITHUB_TOKEN is scoped
  to this repository and cannot read a different private one.
verified: 2026-08-03
---

# The repoos CI job only works while its upstream repo is public

The `repoos` job in `check.yml` fetches the CLI with a plain clone:

```yaml
- name: Fetch RepoOS CLI
  run: git clone --depth 1 https://github.com/HellboundGlory/repository-operating-system.git "$RUNNER_TEMP/repoos"
```

There are no credentials on that clone, so it succeeds only while the upstream
repository is **public**. `GITHUB_TOKEN` is scoped to *this* repository and
confers no read access to a different private one.

## Why this is worth writing down

The failure is a confusing one. Making the upstream private produces:

```
fatal: could not read Username for 'https://github.com': No such device or address
```

That reads like a credentials or authentication misconfiguration in *this*
repository. It is not — it is a visibility setting on a *different* repository,
changed by an action that had nothing to do with CI. Nothing in this repository
currently records the dependency, so the next person to hit it starts by
debugging the wrong thing.

## What to do if it breaks

Confirm the upstream's visibility first, before touching anything here:

```bash
gh repo view HellboundGlory/repository-operating-system --json visibility
```

If it is private, the options are to make it public again, add a PAT with read
access to it as a repository secret, or vendor the CLI into this repository.

The same constraint applies to any future pin: pinning the clone to a tag
changes *which* commit is fetched, not *whether* it can be fetched.
