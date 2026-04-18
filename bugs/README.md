# bugs/

Two artifacts, one folder:

- [**`known-issues.md`**](./known-issues.md) — user-facing list of
  CURRENT limitations and known gotchas. Grows and shrinks over time.
  Entries are REMOVED as the underlying issues get fixed.

- [**`YYYY-MM-DD-*.md`**](./) — dated postmortems for FIXED bugs worth
  learning from, across the whole repo: Python core, gateway, SDKs,
  frontend. One file per bug, retained indefinitely.

Together they answer two different questions:

- *"What should I know before using this system today?"* → `known-issues.md`
- *"What has broken before, and what did it teach us?"* → dated postmortems

Neither is a replacement for GitHub Issues. Every bug still gets an
issue for triage and status; this folder is a durable, versioned record
— the kind of artifact a new maintainer can read six months in to
understand the codebase's failure modes.

## When to write a postmortem

Write one when the bug is **any** of:

- Security-relevant (auth, crypto, tenancy isolation, secret handling)
- Data loss or silent data corruption
- A correctness bug that shipped to users (production regression)
- A pattern-y bug where the same shape could exist in other code paths
- A concurrency or resource-leak bug (even if symptoms are subtle)

**Don't** write one for: typos, dependency bumps, style cleanups, pure
refactors, docs-only changes, or one-off bugs with no generalizable
lesson (e.g. "forgot a null check in a prototype").

The bar: if the fix teaches a future reader something about this
codebase's failure modes, it belongs here.

## Template

Copy this into a new file. Frontmatter fields in the first block are
required. The three sections under "Required" are required. The two
under "Strongly encouraged" are not enforced but are the reason this
folder exists — skipping them makes the postmortem a log entry rather
than a learning artifact.

```markdown
---
id: YYYY-MM-DD-short-kebab-slug
title: One-sentence description of the bug
severity: critical          # critical | high | medium | low
status: fixed               # fixed | mitigated | wont-fix
found: YYYY-MM-DD
fixed: YYYY-MM-DD
area: gateway/api           # free-form — e.g. gateway/api, bindu/core, sdks/typescript
commit: abc1234             # primary fix commit
pr:                         # optional — PR URL if one exists
issue:                      # optional — GitHub issue URL if one exists
---

## Symptom
What a user, operator, or downstream system observes when this bug
triggers. Start from the outside-in — not the code, the behavior.

## Root cause
The specific code path and WHY it was wrong. Include the file and line
reference from the pre-fix state (e.g. `gateway/src/api/plan-route.ts:155`).
Explain the mental model that led to the bug, not just the broken line.

## Fix
What changed, linking to the commit and the regression test. Short —
the commit message already carries the detail.

## Why the tests didn't catch it
Strongly encouraged. The single most useful section in the whole file.
Be honest: missing test, test ran single-threaded, triggering state
required production load, etc. "Nobody thought to test it" is a valid
answer — write it down.

## Class of bug — where else to watch
Strongly encouraged. Generalize the pattern beyond this one instance.
This is what turns a postmortem into a tool that prevents the next
bug instead of just recording the last one. Name specific other code
paths where the same shape could hide.
```

## File naming

`YYYY-MM-DD-short-kebab-slug.md`. The date is the day the bug was found
(not necessarily fixed). The slug is 3–6 lowercase words, kebab-case,
describing the symptom.

Examples:
- `2026-04-18-sse-cross-contamination.md`
- `2026-03-15-did-key-rotation-cache-stale.md`
- `2026-01-07-payment-replay-missing-nonce.md`

## Deletion policy

Nothing gets deleted. A `status: fixed` postmortem stays in this folder
indefinitely. If a bug recurs, write a new postmortem and link to the
prior one from its "Class of bug" section — the pair tells a story the
single entry couldn't.

## Relationship to other tracking

- **GitHub Issues** — where bugs get filed, triaged, assigned, and
  closed. The issue tracker is the source of truth for **status**;
  this folder is the source of truth for **lessons**.

- **[`known-issues.md`](./known-issues.md)** — lives alongside the
  postmortems in this folder. User-facing list of CURRENT limitations
  and known gotchas. Entries are REMOVED as issues are fixed; a
  limitation that graduates into a fully-investigated postmortem moves
  out of `known-issues.md` and (if it taught us something) into a
  dated `YYYY-MM-DD-*.md` file in this folder.

- **Commit messages** — carry the tactical detail of the fix. The
  postmortem summarizes and generalizes; the commit message is the
  change diff's explanation.

## Adding a pre-commit or CI check

Intentionally not enforced today. If the template decays, add a check
in `.github/workflows/` that validates frontmatter schema and presence
of the required sections. Don't enforce prose quality — that makes
people skip writing postmortems entirely.
