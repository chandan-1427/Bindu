# Gateway Test Fleet

Five single-file Bindu agents + a query matrix + a test harness for
driving the gateway's `/plan` endpoint end-to-end.

## Purpose

Surface bugs in the **gateway + planner + bindu client** path that
only manifest when a real agent fleet is behind the gateway. Not a
substitute for unit tests — this is integration + realistic-failure
coverage.

Per the agreement at the top of this exercise:

- **Auth**: full DID + Hydra, end-to-end. Each agent registers itself
  with Hydra on first boot. The gateway signs outbound calls.
- **Agents**: three fresh minimals (joke, math, poet) + two real
  examples (research via DuckDuckGo, Bindu docs FAQ).
- **Fix scope**: bugs in `gateway/src/**` only. Bugs in agent
  examples, framework core, or external services get filed under
  `bugs/` but not fixed in this exercise.

## The fleet

| Agent | File | Port | Model | Tools | Specialty |
|---|---|---|---|---|---|
| joke | `joke_agent.py` | 3773 | `openai/gpt-4o-mini` | — | Tells jokes, declines everything else |
| math | `math_agent.py` | 3775 | `openai/gpt-4o-mini` | — | Solves math step-by-step |
| poet | `poet_agent.py` | 3776 | `openai/gpt-4o-mini` | — | ≤4-line poems |
| research | `research_agent.py` | 3777 | `openai/gpt-4o-mini` | DuckDuckGo | Web research + summarization |
| faq | `faq_agent.py` | 3778 | `openai/gpt-4o-mini` | DuckDuckGo | Bindu docs Q&A |

Gateway itself runs on **port 3774** (`GATEWAY_PORT` in
`gateway/.env.local`), so nothing collides.

Agents pick up `OPENROUTER_API_KEY` from `examples/.env`.

## Prerequisites

```bash
# Python deps for the agents
uv sync --dev --extra agents

# Gateway deps (TypeScript)
cd gateway && npm install && cd ..

# env must contain OPENROUTER_API_KEY; see examples/.env
grep OPENROUTER_API_KEY examples/.env
```

## Bring the fleet up

Two helper scripts:

```bash
# 1. Start all five agents in the background. Each logs to
#    examples/gateway_test_fleet/logs/<agent>.log. On first boot,
#    each agent auto-registers with Hydra at
#    https://hydra-admin.getbindu.com and caches creds under
#    ~/.bindu/<agent>/oauth_credentials.json.
./examples/gateway_test_fleet/start_fleet.sh

# 2. Start the gateway (separate terminal). The gateway loads its
#    own DID (BINDU_GATEWAY_DID_SEED env), registers with Hydra if
#    configured, and listens on 3774.
cd gateway && npm run dev
```

When everything is healthy you can smoke-test any individual agent:

```bash
curl -s http://localhost:3773/.well-known/agent.json | jq '.name, .did'
curl -s http://localhost:3775/.well-known/agent.json | jq '.name, .did'
# ...etc
```

And the gateway:

```bash
curl -s http://localhost:3774/health | jq
curl -s http://localhost:3774/.well-known/did.json | jq
```

## The query matrix

`run_matrix.sh` sends a series of `/plan` requests and prints a
pass/fail per case. Cases are grouped by what they stress-test:

**Routing correctness** — planner should pick the right agent.
- `Q1` single-skill query → one agent responds
- `Q2` unambiguously off-topic → agent refuses politely
- `Q3` multi-step query touching two agents → planner chains them

**Ambiguity** — planner must handle under-specified inputs.
- `Q4` request that could match multiple agents
- `Q5` nonsensical query
- `Q6` empty query string

**Failure modes** — planner + client should surface errors cleanly.
- `Q7` plan references an agent endpoint that doesn't exist
- `Q8` plan requests an agent with bad auth
- `Q9` plan requests skill that doesn't exist on the agent
- `Q10` timeout: agent takes >30s

**Scale** — bounded but large inputs.
- `Q11` question with 10KB of context
- `Q12` plan with 5 agents in the catalog, question routes to one

**Session resume (optional — Phase 2+)** — skipped if gateway
doesn't declare the feature.
- `Q13` two requests with same `session_id`

## Running the matrix

```bash
# All cases
./examples/gateway_test_fleet/run_matrix.sh

# Single case (for iterating on a failure)
./examples/gateway_test_fleet/run_matrix.sh Q7
```

Each case writes its raw SSE output to
`examples/gateway_test_fleet/logs/<case>.sse` and a short summary to
stdout. The runner exits non-zero if any case failed.

## Tearing down

```bash
./examples/gateway_test_fleet/stop_fleet.sh
```

Kills all agent processes by PID file
(`examples/gateway_test_fleet/pids/*.pid`). Hydra client records are
left alone — they're reusable across runs. If you need to wipe them:

```bash
for agent in joke_agent math_agent poet_agent research_agent bindu_docs_agent; do
  curl -X DELETE "https://hydra-admin.getbindu.com/admin/clients/did:bindu:gateway_test_fleet_at_getbindu_com:$agent:<uuid>"
done
```

(You'll need each agent's DID — read it from the agent card after
first boot.)

## What's known to break

Bugs surfaced by this exercise are filed under `bugs/gateway/`. If
you hit something not already filed, capture the request + SSE output
+ gateway logs and add a new entry.
