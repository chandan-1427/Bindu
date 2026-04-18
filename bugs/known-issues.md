# Known Issues

Last updated: 2026-04-18 (Bindu Core review pass added;
idor-task-context-no-ownership-check removed — see postmortem
[`2026-04-18-idor-task-ownership.md`](./2026-04-18-idor-task-ownership.md))

Things the project can't currently do, or that behave in surprising ways.
Each entry has a workaround where one exists. If you hit one of these and
want to help, open a GitHub Issue referencing the slug (e.g.
"Fixes `context-window-hardcoded`").

**This file is user-facing.** It is the first thing a new contributor or
operator reads to calibrate expectations. Entries are REMOVED from here
as issues are fixed — if you're fixing one, delete its section in the
same PR. If the fix teaches a generalizable lesson, also add a
dated postmortem alongside this file in [`bugs/`](./) (see
[`bugs/README.md`](./README.md) for the template).

For the schema behind entries: severity is the impact if someone hits
the limitation (`high` means it blocks common workflows; `low` means
edge-case or workaround is easy); "tracking" is the GitHub Issue number
if one exists.

Entries in each area are ordered by severity: high → medium → low → nit.
Within a severity bucket, order is arbitrary.

---

## Gateway

### High

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

### poll-budget-unbounded-wall-clock

**Severity:** high
**Summary:** `sendAndPoll` in
[`gateway/src/bindu/client/poll.ts`](../gateway/src/bindu/client/poll.ts)
defaults to 60 polls × backoff up to 10 s — worst case ≈ 5 minutes
PER TOOL CALL. A hung peer stalls the planner indefinitely, holds
the `/plan` SSE stream open, and blocks the session row from being
usable. There is no overall deadline for the plan, only a per-HTTP
timeout on the individual JSON-RPC round trip.
**Workaround:** Pass an explicit `maxPolls` or shorter `backoffMs`
schedule when instantiating the Bindu client. For request-level
deadlines the caller must enforce them externally (e.g. client-side
timeout on the SSE `fetch`).
**Tracking:** _(no issue yet)_

### no-session-concurrency-guard

**Severity:** high
**Summary:** Two `/plan` requests sharing the same `session_id` both
append to `gateway_messages` with no serialization. Their histories
interleave — the planner in request A can see request B's
half-written tool results or vice versa, and the LLM's tool_use /
tool_result pairing can silently tangle across sessions. The
compaction dedupe fix ([commit 0655ac1](../commit/0655ac1)) prevents
compaction races but does NOT serialize plan turns themselves.
**Workaround:** Clients should not run concurrent `/plan` requests
against the same session. If concurrent use is genuine (multiple
tabs, etc.), use distinct session IDs and reconcile externally.
**Tracking:** _(no issue yet)_

### Medium

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
**Tracking:** _(no issue yet)_ (related to `poll-budget-unbounded-wall-clock`)

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
`x` both become `call_research_v2_x`. The second registration
silently overwrites the first. A companion bug: `parseAgentFromTool`
uses a non-greedy regex `^call_(.+?)_(.+)$`, so an agent whose name
contains an underscore parses as `agent=first-segment`,
`skill=everything-else` — wrong for the SSE event the handler
emits.
**Workaround:** Use globally-unique agent names in the catalog;
avoid both hyphens and underscores in the same naming scheme; avoid
underscores in agent names entirely if you rely on the `task.started`
SSE agent field being accurate.
**Tracking:** _(no issue yet)_

### agent-catalog-overwrite

**Severity:** medium
**Summary:** `db.updateSessionCatalog` wholesale-overwrites
`gateway_sessions.agent_catalog` on every `/plan`. If the caller
omits an agent from a subsequent turn's catalog (e.g. temporary
unreachability, inventory churn), the gateway drops it from the
session's recorded catalog even though the session's history
references its prior tool calls. Also exposed to a concurrency race
(see [`2026-04-18-compaction-concurrent-races.md`](./2026-04-18-compaction-concurrent-races.md)
— same shape, different column).
**Workaround:** Always send the full agent catalog on every turn,
even if individual agents are temporarily unavailable.
**Tracking:** _(no issue yet)_

### signature-verification-ok-when-unsigned

**Severity:** medium (security-adjacent)
**Summary:** `verifyArtifact` in
[`gateway/src/bindu/identity/verify.ts`](../gateway/src/bindu/identity/verify.ts)
returns `{ ok: true, signed: 0 }` when a peer sends text parts with
no signatures at all. An attacker stripping signatures from a
compromised peer cannot be distinguished from an unsigned peer. Also,
`file` and `data` parts are never verified at all regardless of
signing — a peer that moves payload into a `DataPart` bypasses
signature checks entirely.
**Workaround:** For trust-sensitive peers, set `trust.verifyDID:
true` AND explicitly check `outcome.signatures.signed > 0` in your
own code before trusting the response. Refuse peers that return
`data` or `file` parts for responses that must be verified. The
gateway does not enforce either today.
**Tracking:** _(no issue yet)_

### did-resolver-no-key-id-selection

**Severity:** medium (security-adjacent)
**Summary:** `primaryPublicKeyBase58` in
[`gateway/src/bindu/identity/resolve.ts`](../gateway/src/bindu/identity/resolve.ts)
picks the FIRST public key found in a peer's DID Document. If the
peer publishes multiple keys — e.g. during a rotation window listing
both old and new — the wrong key may be selected for verification,
causing valid signatures to fail or the wrong key to be used
altogether. The A2A DID spec allows explicit `keyId` selection in
signature metadata; the gateway does not consult it.
**Workaround:** For peers using DID verification, pin them to a
specific DID via `trust.pinnedDID` and coordinate rotation windows
out-of-band.
**Tracking:** _(no issue yet)_

### list-messages-pagination-silent

**Severity:** medium
**Summary:** `db.listMessages` has a default limit of 1000 rows
([`gateway/src/db/index.ts`](../gateway/src/db/index.ts)). Very long
sessions silently truncate to the most recent 1000 messages, skipping
the oldest. The planner loads this into its history; the LLM sees a
partial session that starts mid-stream. No error, no warning.
Compaction can fire and accurately summarize what it sees, but the
oldest messages were never in scope.
**Workaround:** Trigger compaction early on sessions expected to
grow large. Long-term, paginate via `created_at` cursor.
**Tracking:** _(no issue yet)_

### tool-input-sent-as-textpart

**Severity:** medium
**Summary:** The planner's tool-execution path
([`gateway/src/planner/index.ts`](../gateway/src/planner/index.ts))
serializes arguments with `JSON.stringify(args)` and sends them as
a Bindu `TextPart`. Many deployed skills expect a structured
`DataPart` (`{kind:"data", data:{…}}`) — especially skills whose
server-side validator parses a typed input schema. Skills that only
accept `DataPart` will reject the `TextPart` outright; skills that
try to parse the JSON string out of a text field will behave
unpredictably.
**Workaround:** None client-side — the gateway always sends
`TextPart`. Affected skills must accept either form on their server
side until this is fixed.
**Tracking:** _(no issue yet)_

### no-rate-limit-cors-body-size-limit

**Severity:** medium
**Summary:** The Hono app
([`gateway/src/server/index.ts`](../gateway/src/server/index.ts))
has no rate limit, no CORS policy, and no body-size limit. A single
client can submit large `/plan` requests or fire many concurrent
requests without any throttling; browser clients from different
origins have no explicit policy. The absence of a body-size limit is
a trivial DoS vector — a 500 MB JSON payload is accepted, parsed,
and held in memory.
**Workaround:** Deploy behind a reverse proxy (nginx, Cloudflare,
API Gateway) that provides these controls. The gateway assumes it
runs behind such a proxy today.
**Tracking:** _(no issue yet)_

### prompt-injection-scrubbing-theater

**Severity:** medium (security)
**Summary:** `wrapRemoteContent` in
[`gateway/src/planner/index.ts`](../gateway/src/planner/index.ts)
strips literal strings like `"ignore previous"` and
`"disregard earlier"` from peer responses before handing them to the
planner LLM. This is trivially bypassable with capitalization,
Unicode homoglyphs, paraphrasing, JSON-encoding the instruction, or
placing it in a non-text part (`file`, `data` — which aren't
scrubbed at all). It offers a false sense of safety without actually
blocking prompt injection; the current defense is worse than no
defense because downstream code may assume it's doing something.
**Workaround:** Do not rely on the scrubber for prompt-injection
resistance. For untrusted peers, apply one or more of: (a) isolate
peer output into an LLM sub-call with its own restricted system
prompt that produces structured data, not free-form instructions;
(b) use provider-side structured-output / tool-choice constraints
to prevent the planner from obeying arbitrary peer instructions;
(c) cap peer responses to a strict JSON schema server-side.
**Tracking:** _(no issue yet)_

### no-graceful-shutdown

**Severity:** medium
**Summary:** The gateway's `close()` function
([`gateway/src/index.ts`](../gateway/src/index.ts)) calls
`httpServer.close()` and `runtime.dispose()` back-to-back. In-flight
`/plan` streams are dropped mid-frame — clients see a truncated
SSE, and the assistant message may be partially written but not
committed. No draining, no deadline, no 5xx return for requests in
flight during a rolling restart.
**Workaround:** Rely on the reverse proxy to drain connections
before sending SIGTERM to the gateway, and run at least two gateway
replicas so dropped connections can be retried against the other.
**Tracking:** _(no issue yet)_

### assistant-message-lost-on-stream-error

**Severity:** medium (data loss, billing)
**Summary:** If the LLM stream errors mid-turn
([`gateway/src/session/prompt.ts`](../gateway/src/session/prompt.ts)),
the Effect generator fails immediately. Tool calls that already
completed (and were already billed via the Bindu agent) are lost
from the assistant message — they never get persisted to
`gateway_messages`. The audit row in `gateway_tasks` still exists
(the tool call completed from the gateway's perspective), but the
session-level history shows no record of the tool_use, so replay is
inconsistent with the audit log.
**Workaround:** None at the application level. Operators should
correlate `gateway_tasks` with `gateway_messages` when investigating
session gaps — don't trust the assistant-message view alone.
**Tracking:** _(no issue yet)_

### json-schema-to-zod-incomplete

**Severity:** medium
**Summary:** `jsonSchemaToZod` in
[`gateway/src/planner/index.ts`](../gateway/src/planner/index.ts)
converts an inbound skill's `inputSchema` to a Zod validator for the
planner LLM. It handles `type: string|number|integer|boolean|array|
object` but ignores every other keyword: `enum`, `oneOf`, `anyOf`,
`pattern`, `minLength`/`maxLength`, `minimum`/`maximum`,
`additionalProperties`, `format`, and more. The planner LLM
therefore receives no signal about valid values; invalid input
passes local validation and reaches the peer, failing late with a
JSON-RPC error.
**Workaround:** Skills should document their full input constraints
in their human-readable `description` so the planner LLM picks them
up from the prompt rather than the schema.
**Tracking:** _(no issue yet)_

### Low

### compaction-dedupe-single-process-only

**Severity:** low (correct today, architectural ceiling)
**Summary:** The fix for concurrent compaction races
([commit 0655ac1](../commit/0655ac1) /
[`2026-04-18-compaction-concurrent-races.md`](./2026-04-18-compaction-concurrent-races.md))
uses an in-process `Map<SessionID, Promise>`. A horizontally-scaled
deployment of the gateway (multiple Node processes fronting one
Supabase) could still race across processes. Single-process
Phase 1 is correct.
**Workaround:** Run a single gateway process. Horizontal scaling is
a Phase 2 concern — when it lands, add a Postgres version column on
`gateway_sessions` with optimistic-concurrency semantics in the
compaction UPDATE, or wrap the whole compaction in a stored
procedure.
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
**Workaround:** Validate required env vars at gateway boot. Or tail
the logs for `"auth: env var … is not set"` — the message is still
present in the error string, just buried under `"transport:"`.
**Tracking:** _(no issue yet)_

### resume-race-duplicate-session

**Severity:** low
**Summary:** Two concurrent `/plan` requests with the same
`session_id` where neither yet exists in `gateway_sessions` will
both miss the `getSession` lookup and both call `sessions.create()`,
producing two rows with the same `external_session_id`. The
`UNIQUE` constraint on `external_session_id` will cause the second
insert to fail — the second request errors back to the caller with
a 500.
**Workaround:** Retry the failing request. The first insert
succeeded, so a retry resolves to the existing row.
**Tracking:** _(no issue yet)_

### cancel-casing-not-retried

**Severity:** low
**Summary:** When `sendAndPoll` exhausts its poll budget
([`gateway/src/bindu/client/poll.ts`](../gateway/src/bindu/client/poll.ts)),
it issues a best-effort `tasks/cancel` to the peer. That cancel
sends `taskId` in camelCase only — it never does the snake_case
retry flip that the poll loop itself performs. For peers that
require `task_id` in snake_case (the very case the flip exists
for), the cancel silently fails and the remote task leaks.
**Workaround:** None. Peers that require snake-case params for
`tasks/cancel` need to support camelCase too, or the task will
orphan on poll timeout.
**Tracking:** _(no issue yet)_

### health-endpoint-no-dependency-probe

**Severity:** low
**Summary:** `GET /health`
([`gateway/src/server/index.ts`](../gateway/src/server/index.ts))
returns `200 {ok: true}` regardless of whether Supabase is
reachable or the configured LLM provider is accepting requests.
Load balancers see "healthy" while the gateway is unable to serve
`/plan` traffic. Good for liveness, useless for readiness.
**Workaround:** Add a separate readiness check in your deployment
that hits `/plan` with a no-op payload and a short deadline.
**Tracking:** _(no issue yet)_

### no-request-id-in-logs

**Severity:** low
**Summary:** `/plan` handler produces no request ID, correlation
ID, or tracing context. When an SSE stream errors and the client
reports a problem, there's no way to correlate the client's
observation with a server-side log line. Server-side logs don't
include session ID either for most events.
**Workaround:** Set `X-Request-Id` on the reverse proxy and
include it in proxy access logs; correlate by timestamp and peer
URL.
**Tracking:** _(no issue yet)_

### no-config-hot-reload

**Severity:** low
**Summary:** Changes to `agents/planner.md`, `gateway.config.json`,
or any permission rules require a full gateway restart. The config
loader reads files once at boot via
[`gateway/src/config/loader.ts`](../gateway/src/config/loader.ts).
**Workaround:** Restart the gateway. For live-tuning the planner
prompt, consider reading it dynamically from DB or a separate
mutable source.
**Tracking:** _(no issue yet)_

### resolve-env-limited-to-simple-var

**Severity:** low
**Summary:** `resolveEnv` in
[`gateway/src/config/loader.ts`](../gateway/src/config/loader.ts)
only matches bare `"$VAR"` strings. It does not handle
`"${VAR}/suffix"`, default values (`"${VAR:-default}"`), nested
interpolation, or shell-style expansion. A config value like
`"https://${HOST}/api"` passes through as a literal string.
**Workaround:** Precompute interpolated values in your env or
config file; don't rely on shell-style expansion inside config
strings.
**Tracking:** _(no issue yet)_

### compaction-summary-injected-as-user-role

**Severity:** low
**Summary:** The compaction summary is injected back into history
as a synthetic message with `role: "user"`
([`gateway/src/session/index.ts`](../gateway/src/session/index.ts)).
Works, but the LLM may mistake the summary for the current user
turn's message — especially when the summary starts with a phrase
the model could interpret as a directive. A system-role injection
(or explicit `[SYSTEM: prior context]` tagging) would be safer.
**Workaround:** The prefix `[Prior session context, compacted]`
already signals the nature of the content; in practice the planner
handles it correctly. Watch for cases where the model echoes the
summary verbatim as if it were a user question.
**Tracking:** _(no issue yet)_

### revert-millisecond-ties-nondeterministic

**Severity:** low
**Summary:** `revertTo` and `revertLastTurn` in
[`gateway/src/session/revert.ts`](../gateway/src/session/revert.ts)
use `created_at` as the boundary for "everything after this
message." If multiple messages were inserted within the same
millisecond (rare but possible under contention), their relative
order is non-deterministic — revert may include or exclude some of
them based on DB-internal ordering.
**Workaround:** Inspect the reverted row set after a revert;
manually unmark any mis-reverted rows. A Phase 2 fix would switch
to a monotonically-increasing `seq` column.
**Tracking:** _(no issue yet)_

### revert-doesnt-cancel-remote-tasks

**Severity:** low
**Summary:** `revertTo` marks local audit rows as `reverted=true`
but does NOT send `tasks/cancel` to the peers for any still-running
Bindu tasks in the reverted window. The remote tasks continue,
consuming peer resources and (for paid skills) accruing cost until
they finish on their own. This is documented as intentional in the
code — peers have already done the work, and cancel semantics are
complex — but may surprise operators.
**Workaround:** Accept that revert only clears local state.
Stragglers complete on the peer side and their audit rows stay
marked reverted so they're hidden from resume.
**Tracking:** _(no issue yet)_

### empty-agents-catalog-no-400

**Severity:** low
**Summary:** `PlanRequest.agents` has a default of `[]`, so a
`/plan` request with no agents is accepted. The planner runs with
zero tools, the LLM attempts to call a tool it has no access to,
and the response is an error message from the LLM — not a clear
"you forgot to send agents" 400.
**Workaround:** Always include at least one agent in the request,
or pre-validate the `agents.length` client-side.
**Tracking:** _(no issue yet)_

### no-migration-rollback

**Severity:** low
**Summary:** Migrations under `gateway/migrations/` are
forward-only — no paired `down.sql` for each change. Reverting a
migration requires manual SQL work.
**Workaround:** For a production deployment that may need
rollback, maintain rollback scripts outside the `migrations/`
folder. This is a common choice for small projects; fix only if
the team actively needs reversible migrations.
**Tracking:** _(no issue yet)_

### Nits

### tasks-recorded-is-dead-state

**Severity:** nit
**Summary:** `tasksRecorded: string[]` accumulated in the planner
([`gateway/src/planner/index.ts`](../gateway/src/planner/index.ts))
is populated inside `buildSkillTool` but never returned via SSE,
never persisted, and never read. Dead code.
**Workaround:** None needed. Remove in a cleanup pass.
**Tracking:** _(no issue yet)_

### map-finish-reason-pointless-ternary

**Severity:** nit
**Summary:** `mapFinishReason` in
[`gateway/src/session/prompt.ts`](../gateway/src/session/prompt.ts)
has a parameter type `StreamEvent["type"] extends "finish" ? any :
any` which is always `any`. The conditional type adds no
information.
**Workaround:** None needed. Simplify in a cleanup pass.
**Tracking:** _(no issue yet)_

### db-effect-promise-swallows-errors

**Severity:** nit (correctness-adjacent)
**Summary:** Two paths in
[`gateway/src/db/index.ts`](../gateway/src/db/index.ts) use
`Effect.promise(...)` which resolves even when the underlying
promise rejects (it treats rejection as a defect, not an Effect
error). Transient Supabase failures at those call sites may
silently resolve without being surfaced to the caller.
**Workaround:** None client-side. Audit `Effect.promise` call
sites; prefer `Effect.tryPromise` with an explicit `catch` for any
non-trivial operation.
**Tracking:** _(no issue yet)_

### test-coverage-gaps

**Severity:** nit
**Summary:** The test suite does not cover: concurrent `/plan`
requests end-to-end (only the pubsub filter is tested); compaction
correctness on long multi-pass sessions (only the wrapper dedupe
and summarizer prompt are tested); revert; SSE frame ordering
under load; non-English payloads; sessions larger than the 1000-row
pagination limit; missing `bearer_env` env vars; aborted requests
propagating to the Bindu client; the snake_case flip on
`tasks/cancel`.
**Workaround:** None — this is an internal backlog item.
Contributors tackling any of the fixable items above should add a
test for it in the same PR.
**Tracking:** _(no issue yet)_

---

## Bindu Core (Python)

### High

### did-signature-fails-open-on-missing-headers

**Severity:** high (security, authentication bypass)
**Summary:** `_verify_did_signature_asgi` in
[`bindu/server/middleware/auth/hydra.py`](../bindu/server/middleware/auth/hydra.py)
lines 164–169 returns `is_valid=True` (with
`{"did_verified": False, "reason": "no_signature_headers"}`) when a
DID-style OAuth client makes a request without `X-DID-Signature`
headers. The caller at line 274 only rejects when `is_valid=False`,
so DID-based signing is effectively optional — any holder of a valid
bearer token whose `client_id` starts with `did:` can skip the
signature layer by simply omitting the headers. The same fail-open
exists on lines 174–176 when the Hydra client metadata returns no
public key.
**Workaround:** If DID signing must be enforced in production, front
the service with a reverse proxy that rejects requests missing
`X-DID-Signature` when the caller identity requires it, or run a
custom middleware in front of the Hydra middleware that makes the
signature mandatory. The correct fix is to change both branches to
return `False` so the request is rejected.
**Tracking:** _(no issue yet)_

### x402-middleware-fails-open-on-body-parse

**Severity:** high (security, payment bypass)
**Summary:** The x402 payment middleware at
[`bindu/server/middleware/x402/x402_middleware.py`](../bindu/server/middleware/x402/x402_middleware.py)
lines 213–215 wraps the initial JSON-RPC body parse in a bare
`except Exception:` and calls `await call_next(request)` on failure.
Any client that can cause the parse to throw — malformed JSON,
unexpected encoding, truncated body — reaches the agent without a
payment check. The same bare except also masks real bugs during
parsing. Adjacent concern: the subsequent check is
`if method not in app_settings.x402.protected_methods`, so a request
that parses but reports an unknown method also bypasses payment.
**Workaround:** Configure x402 only when no protected methods can be
avoided by crafting the request body; otherwise treat the x402
middleware as advisory. The fix is to return a 402 response on parse
failure and narrow the exception to `json.JSONDecodeError` and
`UnicodeDecodeError`.
**Tracking:** _(no issue yet)_

### x402-no-replay-prevention

**Severity:** high (security, payment bypass)
**Summary:** `_validate_payment_manually` in
[`bindu/server/middleware/x402/x402_middleware.py`](../bindu/server/middleware/x402/x402_middleware.py)
lines 282–394 performs five checks (scheme, authorization presence,
amount-minimum, network match, on-chain balance) but never records
or looks up the `(nonce, payer)` or `(txhash, chain)` of the payment.
The same `X-PAYMENT` header is accepted on every request and the
payment session token returned by
[`bindu/server/endpoints/payment_sessions.py`](../bindu/server/endpoints/payment_sessions.py)
is never marked consumed. A client who pays once can reuse the proof
across unlimited requests until the authorization's `validBefore`
expires.
**Workaround:** Set short `validBefore` windows on the EIP-3009
authorization issued to clients, reducing the replay window to
seconds. The real fix is to persist `(nonce, payer_address)` in a
dedupe store (Redis `SETNX` keyed by nonce, TTL ≥ `validBefore`) and
reject any payload whose nonce is already present.
**Tracking:** _(no issue yet)_

### x402-no-signature-verification

**Severity:** high (security, payment forgery)
**Summary:** The validation routine at
[`bindu/server/middleware/x402/x402_middleware.py`](../bindu/server/middleware/x402/x402_middleware.py)
lines 282–394 checks amount, network, and payer balance but never
verifies the EIP-3009 `TransferWithAuthorization` signature against
the payer's address. Any client that knows the payer's public
address and a valid USDC balance can construct a payload and pass
validation without ever signing it. The docstring at line 292 even
labels the signature check "optional" — the actual call does not
verify it. Combined with `x402-no-replay-prevention`, this means
there is no cryptographic binding between the caller and the
payment.
**Workaround:** Do not rely on x402 for revenue protection in the
current release. If revenue matters, sit x402 behind a proxy that
verifies the signature out-of-band, or disable x402 and use a
pre-paid credits model backed by an authenticated account. The fix
is to call `eth_account.Account.recover_message` (or equivalent) on
the EIP-3009 typed-data digest and reject if the recovered address
does not match `auth.from_`.
**Tracking:** _(no issue yet)_

### x402-balance-check-skipped-on-missing-contract-code

**Severity:** high (security, payment bypass)
**Summary:**
[`bindu/server/middleware/x402/x402_middleware.py`](../bindu/server/middleware/x402/x402_middleware.py)
lines 348–352 skip the on-chain balance check when `w3.eth.get_code`
returns empty bytes for the configured token asset. A misconfigured
`payment_requirements.asset`, a transient RPC fault, or an operator
pointing at a fork where the token is not yet deployed all cause the
balance check to silently no-op. The outer `except Exception` at
line 377 correctly fails closed if the balance call itself throws,
but the "no code" branch is a logged warning and a fall-through to
`return True`. An attacker who can influence the RPC provider's
response (or who simply benefits from operator misconfiguration) can
pay with a zero balance.
**Workaround:** Monitor logs for
`"No contract found at … Skipping balance check"` — if it appears
in production, payment is effectively disabled. Pin a known-good RPC
endpoint and verify the token address on startup. The fix is to
reject payment (not skip) when the contract is not found, and to
validate `asset` against a hardcoded list of known USDC addresses
per chain at startup.
**Tracking:** _(no issue yet)_

### Medium

### authz-scope-check-behind-optional-flag

**Severity:** medium (security, authorization)
**Summary:** The scope check in
[`bindu/server/endpoints/a2a_protocol.py`](../bindu/server/endpoints/a2a_protocol.py)
line 153 is wrapped in
`if app_settings.auth.require_permissions:`. When the flag is
falsy (common during bringup, demos, or debugging), the A2A endpoint
accepts any authenticated token for any method — there is no
authorization layer at all, only authentication. Authorization being
a feature flag is a deployment landmine: an operator who turns it off
to "unblock" something forgets to turn it back on and ships a
scopeless service.
**Workaround:** Always deploy with `require_permissions: true` and
define per-method scopes in `auth.permissions`. Treat the flag as
deprecated in your configuration and add a startup assertion that
refuses to boot when the flag is false and auth is enabled.
**Tracking:** _(no issue yet)_

### cors-allow-credentials-with-user-origins

**Severity:** medium (security, CORS misconfig)
**Summary:**
[`bindu/server/applications.py`](../bindu/server/applications.py)
lines 563–571 instantiate `CORSMiddleware` with
`allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`,
and `allow_origins=cors_origins` where `cors_origins` is an
operator-supplied list. Starlette does reject the literal wildcard
`["*"]` with credentials, but an operator passing
`["https://example.com", "null"]`, a reflected-origin scheme, or
simply an over-broad list (every internal tool) still gets a
credentialed cross-origin surface. There is no startup assertion that
the supplied origins are compatible with `allow_credentials=True`.
**Workaround:** Set `cors_origins` to an exhaustive, minimal list of
known origins. Never include `"null"`, `"*"`, or a reflected-origin
scheme. If possible, terminate CORS at a reverse proxy and leave
`cors_origins=None` on the Bindu app.
**Tracking:** _(no issue yet)_

### hydra-token-cache-revocation-lag

**Severity:** medium (security, revocation)
**Summary:** The Hydra middleware caches introspection results for
up to 300 s (`CACHE_TTL_SECONDS = 300`) in
[`bindu/server/middleware/auth/hydra.py`](../bindu/server/middleware/auth/hydra.py).
Revoking a token in Hydra does not clear this in-process cache, so
revoked tokens remain valid for up to five minutes across all Bindu
instances that already cached them. For sensitive operations
(admin, payment capture, key rotation) that window is too long.
**Workaround:** Reduce `CACHE_TTL_SECONDS` for high-risk deployments,
or disable the cache for specific scopes. The fix is a revocation
callback from Hydra (or a short TTL with aggressive eviction) that
invalidates the cache entry on `revoke_token`.
**Tracking:** _(no issue yet)_

### task-cancel-check-then-act-race

**Severity:** medium (correctness, concurrency)
**Summary:**
[`bindu/server/handlers/task_handlers.py`](../bindu/server/handlers/task_handlers.py)
lines 67–95 load the task, read `status.state`, compare against
`app_settings.agent.terminal_states`, and then call
`self.scheduler.cancel_task(...)` without any atomic update between
the read and the write. A worker that completes the task between
those two steps leaves `cancel_task` trying to cancel a task that
already reached a terminal state — the resulting behavior depends
on the scheduler implementation and is not deterministic. The
second `load_task` at line 90 may return a terminal task with the
cancellation ignored, misleading the caller.
**Workaround:** Callers should treat `cancel_task` as best-effort
and always re-check task state after the call returns. Fix is a
compare-and-swap in storage (`update_task_state_if(from, to)`) that
returns false when the state has already moved.
**Tracking:** _(no issue yet)_

### no-rate-limit-or-quota-per-caller

**Severity:** medium (DoS)
**Summary:** The A2A endpoint, the scheduler, and `ManifestWorker`
all run without per-caller quotas or global concurrency caps. A
single authenticated DID can fire `message/send` in a loop and
exhaust the scheduler queue, MongoDB writes, and memory (tasks are
kept hot for fast lookup). Request-body size is also uncapped on
the Bindu app (Starlette default, no explicit limit). Nothing in
`bindu/server/applications.py` or `bindu/server/endpoints/a2a_protocol.py`
imposes rate limits, per-caller task caps, or a worker-pool
semaphore.
**Workaround:** Deploy behind a reverse proxy (nginx, Cloudflare,
API Gateway) that enforces request-rate and body-size limits per
client IP or DID. Operators running Bindu directly on the public
internet are currently exposed. The fix is per-DID quotas enforced
at the `TaskManager.send_message` level plus an explicit body-size
limit on the Starlette app.
**Tracking:** _(no issue yet)_ (shape-equivalent to the gateway's
`no-rate-limit-cors-body-size-limit` entry)

### types-populate-by-name-missing

**Severity:** medium (developer experience, cross-SDK compat)
**Summary:** All types in
[`bindu/common/protocol/types.py`](../bindu/common/protocol/types.py)
are decorated with
`@pydantic.with_config(ConfigDict(alias_generator=to_camel))` and the
server dumps responses with `by_alias=True`. The wire format is
therefore correctly camelCase (A2A 0.3.0 compliant). But
`populate_by_name=True` is *not* set, so on input the Python
validator only accepts the camelCase alias (`contextId`,
`messageId`, `taskId`). A Python-native client that hand-builds the
request with snake_case keys (`context_id`, `message_id`, `task_id`)
fails validation or silently drops fields. This confuses developers
because the Python code itself uses snake_case attribute names; the
asymmetry is invisible until something breaks at the wire.
**Workaround:** Always send camelCase on the wire, even from Python
clients. The one-line fix is to add `populate_by_name=True` to the
`ConfigDict` on every typed dict, which makes the server accept
either form on input while keeping camelCase on output.
**Tracking:** _(no issue yet)_

### context-id-silent-fallback

**Severity:** medium (correctness, silent data loss)
**Summary:** `_parse_context_id` in
[`bindu/server/task_manager.py`](../bindu/server/task_manager.py)
lines 196–216 logs a warning and returns a fresh UUID when the
client sends a malformed `context_id`. The caller believes they are
continuing conversation X and actually start a new isolated one;
the old context is orphaned in storage. This also gives an attacker
a cheap way to inflate storage by sending thousands of malformed
context IDs.
**Workaround:** Clients must validate `context_id` before sending.
The fix is to reject malformed UUIDs with a JSON-RPC error
(-32602 "Invalid params") rather than fabricate a new one.
**Tracking:** _(no issue yet)_

### Low

### did-signature-overbroad-exception-catch

**Severity:** low (observability, security hygiene)
**Summary:** `verify_signature` in
[`bindu/utils/did/signature.py`](../bindu/utils/did/signature.py)
catches `(BadSignatureError, ValueError, TypeError, Exception)` and
returns `is_valid=False` for all of them. The broad tail-`Exception`
masks real bugs (attribute errors, missing keys, base58 library
faults) as ordinary signature failures, making incidents hard to
diagnose and blurring the distinction between "malformed input" and
"cryptographic fail."
**Workaround:** Grep server logs for `Signature verification failed:`
and inspect the exception class to tell bugs from bad signatures.
Fix is to split decode from verify: catch `ValueError`/`TypeError`
around base58 decode and return an explicit decode-error reason;
catch only `BadSignatureError` around `verify_key.verify`.
**Tracking:** _(no issue yet)_

### artifact-name-not-sanitized

**Severity:** low (security, path handling)
**Summary:** `Artifact.from_result` in
[`bindu/utils/worker/artifacts.py`](../bindu/utils/worker/artifacts.py)
accepts an `artifact_name` passed from the agent manifest and
persists it verbatim without any basename or character filtering.
If a downstream storage backend constructs a filesystem path from
that name (current MongoDB storage does not, but any file-based or
S3-prefixed backend would), an agent that returns
`artifact_name="../../etc/passwd"` writes outside the expected
directory. Defensive sanitization is cheap and the surface is
visible.
**Workaround:** Operators running a file-backed artifact store
should apply `os.path.basename` and an allow-list regex before
writing. Fix in-core is to sanitize in `from_result`:
`artifact_name = os.path.basename(artifact_name) or "result"`.
**Tracking:** _(no issue yet)_

### did-document-endpoint-returns-raw-dict

**Severity:** low (protocol consistency)
**Summary:**
[`bindu/server/endpoints/did_endpoints.py`](../bindu/server/endpoints/did_endpoints.py)
returns the DID document extension output with
`JSONResponse(content=did_document)`, bypassing the pydantic
`by_alias=True` serialization used everywhere else. For W3C DID
documents the key names are already the expected form, so this is
usually harmless. But any Bindu-specific extension fields mixed into
the document leak out as snake_case, inconsistent with the rest of
the API. If the DID document is ever consumed by strict A2A
tooling, the inconsistency becomes a real compatibility bug.
**Workaround:** Confirm any DID extension fields use camelCase keys
at the source. Fix is to route the response through a pydantic
RootModel with the standard camelCase alias generator, or to assert
on the key shape before returning.
**Tracking:** _(no issue yet)_

---

## SDKs (TypeScript)

_No entries yet. Add them when the TS SDK's review pass lands._

---

## Frontend

_No entries yet._
