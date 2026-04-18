# Known Issues

Last updated: 2026-04-18

Things the project can't currently do, or that behave in surprising ways.
Each entry has a workaround where one exists. If you hit one of these and
want to help, open a GitHub Issue referencing the slug (e.g.
"Fixes `context-window-hardcoded`").

**This file is user-facing.** It is the first thing a new contributor or
operator reads to calibrate expectations. Entries are REMOVED from here
as issues are fixed — if you're fixing one, delete its section in the
same PR. If the fix teaches a generalizable lesson, also add a postmortem
under [`bugs/`](../bugs/).

For the schema behind entries: severity is the impact if someone hits
the limitation (`high` means it blocks common workflows; `low` means
edge-case or workaround is easy); "tracking" is the GitHub Issue number
if one exists.

---

## Gateway

### context-window-hardcoded

**Severity:** high
**Summary:** The compaction threshold in
[`gateway/src/session/overflow.ts`](../gateway/src/session/overflow.ts)
assumes a 200,000-token context window (Claude Opus 4.x). Using a
smaller model (GPT-4o-mini at 128k, Haiku at 200k, Gemini Flash at
1M, etc.) means compaction fires at the wrong time — either too late
(provider rejects the request for overflow before compaction runs) or
too early (unnecessary summarization cost).
**Workaround:** Pass an explicit `threshold.contextWindow` matching
your actual model when calling `compactIfNeeded`. For multi-model
deployments this needs per-model configuration the gateway doesn't
currently expose.
**Tracking:** _(no issue yet)_

### abort-signal-not-propagated-to-bindu-client

**Severity:** medium
**Summary:** When a client disconnects mid-`/plan`, the gateway's
SSE handler aborts — but in-flight polling loops against downstream
Bindu agents (`gateway/src/bindu/client/poll.ts`) do not cancel. Each
in-flight tool call continues for up to 60 attempts × backoff
(≈ 5 minutes worst case) after the user is gone.
**Workaround:** None client-side. Accept that aborted `/plan`
requests may leave stragglers consuming gateway + peer compute
for several minutes.
**Tracking:** _(no issue yet)_

### permission-rules-not-enforced-for-tool-calls

**Severity:** medium
**Summary:** `agents/planner.md` declares `permission: agent_call:
ask`, and the Permission service exists and evaluates wildcards
correctly. But the planner's tool-execution path
(`gateway/src/session/prompt.ts`) never calls
`Permission.Service.evaluate()` before running a Bindu tool. The
permission system is effectively dead code for tool calls today.
**Workaround:** Control tool access via the `agents[]` catalog the
caller sends in the `/plan` request — only include agents the caller
is allowed to invoke.
**Tracking:** _(no issue yet)_

### tool-name-collisions-silent

**Severity:** medium
**Summary:** `normalizeToolName` in
[`gateway/src/planner/index.ts`](../gateway/src/planner/index.ts)
replaces non-alphanumeric characters with `_` and truncates to 80
chars. Distinct `(agent, skill)` pairs can map to the same tool id:
e.g. agent `research-v2` + skill `x` and agent `research_v2` + skill
`x` both become `call_research_v2_x`. The second registration silently
overwrites the first.
**Workaround:** Use globally-unique agent names in the catalog;
avoid both hyphens and underscores in the same naming scheme.
**Tracking:** _(no issue yet)_

### agent-catalog-overwrite

**Severity:** medium
**Summary:** `db.updateSessionCatalog` wholesale-overwrites
`gateway_sessions.agent_catalog` on every `/plan`. If the caller
omits an agent from a subsequent turn's catalog (e.g. temporary
unreachability, inventory churn), the gateway drops it from the
session's recorded catalog even though the session's history
references its prior tool calls. Also exposed to a concurrency race
(see `compaction-concurrent-races` postmortem — same shape, different
column).
**Workaround:** Always send the full agent catalog on every turn,
even if individual agents are temporarily unavailable.
**Tracking:** _(no issue yet)_

### compaction-dedupe-single-process-only

**Severity:** medium
**Summary:** The fix for concurrent compaction races
([commit 0655ac1](../bugs/2026-04-18-compaction-concurrent-races.md))
uses an in-process `Map<SessionID, Promise>`. A horizontally-scaled
deployment of the gateway (multiple Node processes fronting one
Supabase) could still race across processes. Single-process
Phase 1 is correct.
**Workaround:** Run a single gateway process. Horizontal scaling is
a Phase 2 concern — when it lands, add a Postgres version column on
`gateway_sessions` with optimistic-concurrency semantics in the
compaction UPDATE.
**Tracking:** _(no issue yet)_

### signature-verification-ok-when-unsigned

**Severity:** medium (security-adjacent)
**Summary:** `verifyArtifact` in
[`gateway/src/bindu/identity/verify.ts`](../gateway/src/bindu/identity/verify.ts)
returns `{ ok: true, signed: 0 }` when a peer sends text parts with
no signatures at all. An attacker stripping signatures from a
compromised peer cannot be distinguished from an unsigned peer. Also,
`file` and `data` parts are never verified at all regardless of
signing.
**Workaround:** For trust-sensitive peers, set `trust.verifyDID:
true` AND explicitly check `outcome.signatures.signed > 0` in your
own code before trusting the response. The gateway does not enforce
this today.
**Tracking:** _(no issue yet)_

### list-messages-pagination-silent

**Severity:** medium
**Summary:** `db.listMessages` has a default limit of 1000 rows
(`gateway/src/db/index.ts`). Very long sessions silently truncate to
the most recent 1000 messages, skipping the oldest. The planner
loads this into its history; the LLM sees a partial session that
starts mid-stream. No error, no warning.
**Workaround:** Trigger compaction early on sessions expected to
grow large. Long-term, paginate via `created_at` cursor.
**Tracking:** _(no issue yet)_

### no-ttl-cleanup

**Severity:** low
**Summary:** Config declares `gateway.session.ttlDays` (default 30)
but nothing actually cleans up old sessions. `gateway_sessions`,
`gateway_messages`, and `gateway_tasks` grow unbounded.
**Workaround:** Run a scheduled Supabase SQL job to delete rows
older than your desired TTL. The gateway does not do this
automatically.
**Tracking:** _(no issue yet)_

### no-rate-limit-cors-body-size-limit

**Severity:** medium
**Summary:** The Hono app
([`gateway/src/server/index.ts`](../gateway/src/server/index.ts))
has no rate limit, no CORS policy, and no body-size limit. A
single client can submit large `/plan` requests or fire many
concurrent requests without any throttling; browser clients from
different origins have no explicit policy.
**Workaround:** Deploy behind a reverse proxy (nginx, Cloudflare,
API Gateway) that provides these controls. The gateway assumes it
runs behind such a proxy today.
**Tracking:** _(no issue yet)_

### token-estimation-chars-div-4

**Severity:** low
**Summary:** `approxTokens` in
[`gateway/src/session/overflow.ts`](../gateway/src/session/overflow.ts)
uses `chars / 4` as its token count heuristic. Accurate for English
prose; wrong for code (more tokens per char due to punctuation),
wildly wrong for CJK (closer to `chars / 1.5`). Combined with
`context-window-hardcoded`, compaction timing for non-English
sessions is unreliable.
**Workaround:** Set a more conservative `triggerFraction` (e.g.
`0.6` instead of `0.8`) if your sessions are primarily code or
CJK-language content.
**Tracking:** _(no issue yet)_

### did-resolver-no-stampede-protection

**Severity:** low
**Summary:** The DID resolver in
[`gateway/src/bindu/identity/resolve.ts`](../gateway/src/bindu/identity/resolve.ts)
caches DID Documents with a 5-minute TTL. When the cache expires
(or is cold on first call), concurrent `resolve()` calls for the
same DID all miss and issue simultaneous HTTP fetches to the peer's
`/did/resolve`. Functionally harmless; wasteful.
**Workaround:** None needed in practice — 5 minutes is long enough
that stampedes are rare. If they become a problem, add a
second-level in-flight dedupe (same pattern as compaction-dedupe).
**Tracking:** _(no issue yet)_

### bearer-env-error-collapses-to-transport

**Severity:** low
**Summary:** When `auth: { type: "bearer_env", envVar: "FOO" }` is
configured for a peer but `$FOO` is unset, `authHeaders()` throws
from inside the async `runCall` in the Bindu client. The error is
caught by the Effect machinery and wrapped as a generic transport
error (`BinduError.transport(...)`), losing the "configuration
missing" context. The operator can't tell "missing env" from "peer
down."
**Workaround:** Validate required env vars at gateway boot. Or
tail the logs for "auth: env var … is not set" — the message is
still present in the error string, just buried under "transport:".
**Tracking:** _(no issue yet)_

---

## Bindu Core (Python)

_No entries yet. Add them when the Python core's review pass lands._

---

## SDKs (TypeScript)

_No entries yet. Add them when the TS SDK's review pass lands._

---

## Frontend

_No entries yet._
