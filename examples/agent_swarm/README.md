# Agent Swarm

Five Agno agents stitched together by an in-process orchestrator: Planner → Researcher → Summarizer → Critic → Reflection. Each agent is a regular `agno.agent.Agent` with OpenRouter behind it; the orchestrator passes intermediate state along the chain. The whole pipeline is exposed as a single bindu agent over A2A.

This is the closest example to "what does a real agent product look like" — multi-step reasoning, agent-as-tool, retry-on-critique. Plan on 30–60s per task while the chain runs.

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
uv sync --extra agents
```

## Run

```bash
uv run examples/agent_swarm/bindu_super_agent.py
# http://localhost:3773
```

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Research the current state of agent-to-agent payment protocols and produce a one-page brief."}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

Then `tasks/get` with the same `taskId` — but give the swarm 120s+ before you expect a final state. The artifact is the Reflection agent's pass over the Critic's pass over the Summarizer's draft.

## What's in here

| File | Role |
| --- | --- |
| `bindu_super_agent.py` | The bindu wrapper — entry point. |
| `orchestrator.py` | In-process Planner → Researcher → Summarizer → Critic → Reflection chain. |
| `planner_agent.py` | Breaks the user request into research questions. |
| `researcher_agent.py` | Agno + DuckDuckGo per question. |
| `summarizer_agent.py` | Condenses research into a draft. |
| `critic_agent.py` | Reviews and asks for revisions. |
| `reflection_agent.py` | Final pass — decides "ship" or "loop again". |

With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
