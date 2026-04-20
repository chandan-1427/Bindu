# Bugs and Known Issues — Bindu Gateway

Living list of things that are wrong, brittle, or missing. Everything here is
grounded in specific files and line numbers so fixing them is a concrete task,
not a discovery project.

**Legend:**
- 🔴 **high** — behavior is subtly wrong or security-adjacent; fix before
  anyone depends on it for production guarantees.
- 🟠 **medium** — real gap, not urgent, will bite someone eventually.
- 🟡 **low** — DX wart, stale comment, or nice-to-have.

**Last reviewed:** 2026-04-20, on branch `feat/gateway-recipes`.

---

## Security and correctness

### ✅ RESOLVED — `signatures.ok === true` was vacuously true

**Was at:** [`src/bindu/client/index.ts:218`](../src/bindu/client/index.ts:218)
(unchanged — that's the authoritative `ok` boolean, which still has
`signed === 0 ? true` semantics because "nothing to fail" isn't a failure).

**Fixed by:** making the `<remote_content>` envelope label four-valued
instead of three-valued. See
[`computeVerifiedLabel()`](../src/planner/index.ts) — new pure helper
exported so the mapping is testable without the whole peer-call loop.

```
null                                      → "unknown"
!ok                                       → "no"
ok && signed === 0                        → "unsigned"   <-- new
ok && signed > 0 && signed === verified   → "yes"
```

Before the fix, an agent that returned artifacts with no signatures
attached caused `signatures.ok` to be vacuously `true`, which the
envelope stamped as `verified="yes"` — indistinguishable from a real
cryptographic pass. The planner LLM trusted it equally. Post-fix the
`unsigned` label surfaces the ambiguity explicitly so the planner can
downweight unverified-hearsay responses in its reasoning.

Coverage: [`tests/planner/verified-label.test.ts`](../tests/planner/verified-label.test.ts) — 7 cases pinning each branch including the regression (vacuous-yes becomes `"unsigned"`).

Shipped on branch `feat/gateway-recipes` prior to merge.

---

### 🔴 `peer.card` is never populated — AgentCard-based DID fallback is dead code

**Where:** [`src/bindu/client/index.ts:196`](../src/bindu/client/index.ts:196)

```ts
const did = peer.trust.pinnedDID ?? (peer.card ? getPeerDID(peer.card) : null)
```

The `peer.card` branch is permanently `null` — nothing in the codebase
fetches `/.well-known/agent.json` or sets `PeerDescriptor.card`. Grep
confirms: no writes to `peer.card =` anywhere. Either:

1. Implement AgentCard fetch at first call per session (the "option C"
   from the earlier design discussion), OR
2. Delete the fallback and mark `peer.card` as reserved for a future
   feature — pretending the fallback exists is worse than owning up.

The plan-route's [`findPinnedDID()`](../src/api/plan-route.ts:314) also
only reads `pinnedDID`, so `agent_did` in SSE is `null` whenever the
caller didn't pin. Users quickly trip on this.

---

### 🟠 `pinnedDID` accepts any string — no validation that it looks like a DID

**Where:** [`src/planner/index.ts:77-79`](../src/planner/index.ts:77)

```ts
trust: z.object({
  verifyDID: z.boolean().optional(),
  pinnedDID: z.string().optional(),
}).optional(),
```

A caller can send `pinnedDID: "hello"` and the gateway will dutifully echo
`"hello"` in every SSE `agent_did` frame and try to resolve it (fails
silently at resolver). This burned us once with literal `${RESEARCH_DID}`
from an un-interpolated Postman variable.

**Fix:** refine the Zod schema with `.regex(/^did:[a-z0-9]+:/)` at minimum.
Better: reject unknown DID methods (keep a whitelist: `did:bindu`,
`did:key`). Give the caller a 400 with a clear "didn't look like a DID"
message at the API boundary, not a silent misconfiguration.

---

### 🟠 Session continuation silently overwrites `agentCatalog` on every call

**Where:** [`src/planner/index.ts:184`](../src/planner/index.ts:184)

```ts
if (existing) {
  yield* db.updateSessionCatalog(sessionID, request.agents)
}
```

A second `/plan` with the same `session_id` and a different (shorter?
empty?) `agents` list replaces the catalog in the DB. Prior turns in the
session's history still reference the old catalog's tool names, but the
planner going forward sees the new catalog. If the user's second call
has fewer agents, the planner can't "call back" the agents from turn 1
even though history suggests they existed.

**Fix options:**
- Reject catalog mutation on resumed sessions (strict — might frustrate
  callers who want to extend mid-conversation).
- Append rather than replace (accumulate over session lifetime).
- Version the catalog per message so history correctly references the
  catalog that existed at the time the message was written.

Today's silent-replace is the worst of the three — it pretends nothing
changed while changing it.

---

### 🟠 `Recipe.available(agent)` treats "ask" like "allow"

**Where:** [`src/recipe/index.ts:207-212`](../src/recipe/index.ts:207)

```ts
return recipes.filter(
  (r) => permEvaluate(rs, { permission: "recipe", target: r.name, defaultAction: "allow" }) !== "deny",
)
```

The permission evaluator returns `allow | deny | ask`. The recipe loader
filters only `deny`. That means a recipe with `permission: recipe: { "x": "ask" }`
will be **shown to the agent and loadable** without any interactive check —
`ctx.ask` on Tool.Context is a no-op today (see next item).

**Fix:** decide the semantics now. Either:
- Treat "ask" as "deny until a permission UI ships" (safer default), OR
- Document that "ask" is identical to "allow" until Phase 2 — and change
  the evaluator's three-valued return to a two-valued one for recipes.

Current state will bite the first operator who writes `"ask"` thinking
it's restrictive.

---

### 🟠 `ctx.ask` permission hook is never wired

**Where:** [`src/session/prompt.ts:390-405`](../src/session/prompt.ts:390) (the `wrapTool` function)

The `ToolContext` interface in [`src/tool/tool.ts:26`](../src/tool/tool.ts:26)
declares `ask?` as optional, and `wrapTool` constructs the context without
setting it. [`src/tool/recipe.ts:130-133`](../src/tool/recipe.ts:130) guards
the call (`if (ctx.ask) { ... }`) so there's no crash — it's just silently
skipped on every call.

This means recipes load unconditionally today, permission config
notwithstanding. It's a known Phase-2 gap but operators reading the
`permission.recipe:` docs might reasonably expect it to work.

**Fix:** either (a) wire a real `ask` implementation that can at minimum
log denied loads for later audit, or (b) add a `WARN: ctx.ask not wired`
log line at boot so operators see it.

---

## Reliability and observability

### 🟠 No request size limit on `/plan` body

**Where:** [`src/api/plan-route.ts:62-68`](../src/api/plan-route.ts:62)

```ts
const body = await c.req.json()
request = PlanRequest.parse(body)
```

Hono doesn't cap the body by default. A caller could POST a 100 MB
`agents[]` array and the gateway will happily parse it, run through
Zod, and push it into Supabase. At minimum it'll thrash memory.

**Fix:** add a `bodyLimit` middleware on the `/plan` route — probably
1 MB for now (generous for real catalogs, hard-stops runaway payloads).

---

### 🟠 Supabase failures mid-stream surface as a generic `event: error`

**Where:** [`src/api/plan-route.ts:181-187`](../src/api/plan-route.ts:181)

```ts
try {
  await Effect.runPromise(planner.runPlan(sessionCtx, request, { abort: ac.signal }))
} catch (e) {
  await stream.writeSSE({
    event: "error",
    data: JSON.stringify({ message: (e as Error).message }),
  })
}
```

If Supabase goes down mid-plan, the generic `Error.message` ends up in
the SSE. Useful for a developer tailing logs; unhelpful for a caller
trying to write retry logic — no error code, no structured category.

**Fix:** classify errors into a small enum (`db_failed`,
`peer_failed`, `llm_failed`, `timeout`) at the boundary and emit both
the code and the message.

---

### 🟠 No observability — structured logs, tracing, correlation IDs

No OTel, no structured-log fields, no correlation ID threaded through
Bus events. Debugging a production incident today means grepping
`console.log` output against the wall clock.

**Fix path:**
- Adopt a structured logger (`pino` is what OpenCode uses and we
  already vendored Effect).
- Add a `request_id` to every `Bus.publish` so a grep can follow one
  `/plan` end-to-end.
- Wrap `planner.runPlan` in an OTel span when the env var
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

---

### 🟡 `/health` checks no downstream connectivity

By design (see `src/api/health-route.ts` module docstring) `/health`
doesn't ping Supabase or OpenRouter. That's correct for liveness probes
but leaves **no readiness endpoint** that does check downstream state.
An operator wanting k8s readiness gating has nowhere to wire it.

**Fix:** add `/ready` that *does* ping Supabase + fetches OpenRouter's
`/models` with a short timeout. Return 503 if either fails. Keep
`/health` cheap for liveness.

---

## Recipes

### 🟠 No hot reload — authoring loop requires a gateway restart

**Where:** [`src/recipe/index.ts:160-195`](../src/recipe/index.ts:160) — the
layer reads the filesystem once at init.

Write a recipe, save, run `/plan` — planner uses the old recipe list
(or none if it's your first). Tight authoring loop needs Ctrl-C +
`npm run dev` every time.

**Fix idea:** `chokidar` watch on `recipes/` dir → re-run
`loadRecipesDir` → swap state on change. Careful with the
`InstanceState`-style caching; the Effect layer will need a
cache-invalidation hook.

---

### 🟡 `load_recipe` emits `agent_did: null` in SSE — can confuse consumers

**Where:** `src/api/plan-route.ts` — `findPinnedDID` returns `null` for
any tool whose name doesn't match a catalog `agents[].name`, which is
correct for `load_recipe` (not a peer call) but consumers that filter
`task.*` frames by DID won't find this one. It looks like a peer call
that failed DID pinning.

**Fix:** add an explicit `tool_kind: "peer" | "local"` field on the
SSE frames so consumers can partition. Right now the `agent` field
sometimes means "catalog entry name" (peer calls) and sometimes means
"local tool id" (load_recipe) — overloading.

---

### 🟡 Recipe bundled-file scan has no depth signal in output

**Where:** [`src/tool/recipe.ts:75-102`](../src/tool/recipe.ts:75)

The tool returns a flat list of files inside `<recipe_files>` —
relative paths only, no hint that the scan bottomed out at 10 entries
or 2 levels deep. If a recipe has >10 files, the planner silently sees
a truncated list.

**Fix:** include an explicit `truncated: true | false` signal in the
metadata returned by the tool, and emit a console warning when a
recipe dir has more than 10 files.

---

## Fleet / DX

### 🟡 `faq_agent.py` registers as `bindu_docs_agent` — confusing DID name

**Where:** `examples/gateway_test_fleet/faq_agent.py` (Python side, not
gateway code)

Observed during the DID-printing work:
```
faq_agent :3778  did:bindu:gateway_test_fleet_at_getbindu_com:bindu_docs_agent:9327ab1d-...
```

The DID segment is `bindu_docs_agent` because that's what the Python
agent registered itself as. The filename and the conventional catalog
name say `faq`. First-time readers of STORY.md Chapter 3 will stumble
on the mismatch.

**Fix:** rename the Python agent to register consistently as
`faq_agent` OR rename the Python file to `bindu_docs_agent.py`. Pick
one, fix in one place.

---

### 🟡 `.fleet.env` can go stale if agents regenerate DIDs

The script regenerates `.fleet.env` on every run via `>`, so this is
fine in practice. But if an agent's DID seed rotates (delete
`~/.bindu/`, restart), and a user has an old shell with
`$RESEARCH_DID` set from a sourced `.fleet.env`, their next `/plan`
will pin the old DID and signature verification will fail cryptically.

**Fix:** add a comment to `.fleet.env` reminding users to re-source
after any fleet restart, and have `start_fleet.sh` print a line
saying "if your shell has old DIDs sourced, re-source `.fleet.env`".

---

## API surface

### 🟡 No explicit `Accept: text/event-stream` enforcement on `/plan`

Clients that POST without the header still get SSE. Not strictly
wrong (Hono streams regardless) but the implicit contract is
"everyone wants SSE back," which is only true by convention.

**Fix:** either document `Accept` as required in openapi.yaml (it's
not today) or enforce it with a 406 for anything that doesn't list
`text/event-stream` or `*/*`.

---

### 🟡 OpenRouter is the only supported provider

**Where:** [`src/provider/index.ts`](../src/provider/index.ts)

Swapping to a different LLM provider is a code change, not config.
The `model` field accepts `openrouter/…` strings and everything
downstream assumes that prefix.

**Fix:** make provider lookup factory-style — `openrouter/*` →
OpenRouterProvider, `anthropic/*` → AnthropicProvider, etc. Not
urgent since OpenRouter already proxies almost everything, but
worth doing before any customer asks for it.

---

## Tests and coverage gaps

### 🟡 No planner-layer integration test

We skipped this in Phase 7 of the recipes work because mocking
Provider + Session + DB + Bus is heavy. The unit tests for the
loader and tool cover the contracts, and the `/plan` SSE handler
has its own filter test, but no single test walks a request
end-to-end through the planner with a mocked LLM.

**Fix:** build a layer that replaces `Provider.Service` with a
fake that emits a canned `StreamEvent` sequence, then assert the
SSE output matches expectations. Would also let us test the
signature-surfacing work against synthetic tool results.

---

### 🟡 No health-endpoint integration test

[`tests/api/health-route.test.ts`](../tests/api/health-route.test.ts)
only tests the pure helpers (`splitModelId`, `deriveGatewayId`,
`deriveAuthor`). The actual handler construction + response shape
is covered only by manual curl.

**Fix:** add a test that builds the real layer graph (minus
Supabase — mock it), invokes the handler against a stub Hono
context, and asserts the full response body. Would catch drift
between the openapi schema and the actual response.

---

## Docs

### 🟡 STORY.md Chapter 5 references `BINDU_GATEWAY_HYDRA_SCOPE` only via
the gateway README — no standalone explanation.

A reader going through STORY.md linearly hits Chapter 5 and needs
to understand what scopes mean before the DID-signing setup makes
sense. The README covers it but STORY.md doesn't.

**Fix:** one-paragraph sidebar in Chapter 5 explaining "OAuth
scopes are just labels we ask Hydra to stamp on tokens; peers
check they have `agent:read` + `agent:write` before accepting
a /message/send". Not technical, just context.

---

### 🟡 openapi.yaml lists SSE event schemas that aren't `$ref`'d

Current redocly lint reports 13 "unused component" warnings for
`SSEEvent_Session`, `_Plan`, `_TextDelta`, `_TaskStarted`, etc.
OpenAPI 3.1 has no native SSE modeling so those schemas sit as
reference docs rather than being spliced into a response body.

**Fix options:**
- Accept the warnings as documented (low-effort, pragmatic).
- Use `oneOf` inside the response's `text/event-stream` schema
  to enumerate every event shape. Stretches OpenAPI but at
  least gets the schemas used.
- Publish a second spec file (AsyncAPI 2.x or 3.x) for the
  SSE surface. AsyncAPI natively models event streams.

---

## How to add to this list

When you find a gotcha while working on the gateway, add an entry
here. Format:

- **Title** with severity icon
- **Where** — file path + line number (click-through)
- **What** — observed behavior + one-line hypothesis of cause
- **Fix** — concrete direction, not a rewrite

Keep entries factual and file-path-grounded. Speculative "would be
nice" wishes belong in GitHub issues; this file is for verifiable
defects and real gaps.
