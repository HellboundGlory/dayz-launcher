# `memory/inbox/`

**Agents write here. Only here.**

Low trust by default. Nothing in this directory is authoritative, and nothing
here may override `knowledge/`, `conventions/`, or `decisions/`.

Entries expire after 30 days unless given an explicit `expires` date.

## Shape of an entry

```markdown
---
title: Ledger replay walks the full event log
type: memory
confidence: medium
source: <pr-number, issue, or agent identifier>
applies_to: [src/ledger/replay.*]
expires: 2026-09-15
summary: >
  There is no snapshot; replay is linear in event count. Above roughly 2M
  events this exceeds the job timeout.
---

Noticed while investigating the nightly reconciliation timeout.
```

## Curating this directory

Periodically — monthly is plenty — go through and for each entry:

- **Durable claim about the system?** → move to `.ai/knowledge/`
- **Hard-won experience?** → move to `../lessons/`
- **Wrong, trivial, or already obsolete?** → **delete it**

Deleting is the expected outcome for most entries. Git keeps the history if you
ever want it back.

---

*Keep this README — it's the only thing marking the directory as the agent write
path once the directory is otherwise empty.*
