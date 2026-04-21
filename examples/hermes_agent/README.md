# Hermes-Agent via Bindu

Run [hermes-agent](https://github.com/NousResearch/hermes-agent) — a full tool-
using coding/research agent — as a Bindu A2A microservice. You get Hermes's
tool loop (web search, file ops, code execution, browser, MCP, etc.) behind
Bindu's DID identity, A2A protocol, OAuth2, and x402 payments.

The adapter that does the wrapping lives in the hermes-agent repo as the
`[bindu]` optional extra. This example is a thin pointer.

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- A model API key — `OPENROUTER_API_KEY` (or whichever provider your model uses)

## Run

```bash
cd examples/hermes_agent
cp .env.example .env && vim .env        # set your model key

uv pip install 'hermes-agent[bindu]'
python hermes_simple_example.py
```

Equivalent one-liner via the Hermes CLI:

```bash
uv run hermes bindu serve
```

## Safety tiers

A bindufied Hermes can expose powerful local tools. Pick the tier matching
your deployment:

| `HERMES_BINDU_TIER` | Toolset | When to use |
|---|---|---|
| `read` (default) | web search + extract | Public / tunneled deployments |
| `sandbox` | adds filesystem + `execute_code` | Trusted caller, local FS |
| `full` | everything incl. terminal, browser | Localhost-only, private |

**Do not combine `full` with a public tunnel** — that's RCE-as-a-service.

## Fire-and-pull (quick demo)

All IDs must be real UUIDs. `tasks/get` keys off `taskId` (not `id`). See the
authoritative [openapi.yaml](https://github.com/raahulrahl/docs/blob/main/openapi.yaml)
for the complete JSON-RPC surface (`tasks/list`, `tasks/cancel`,
`contexts/list`, push notifications, `message/stream`, …).

```bash
uuid() { uuidgen | tr 'A-Z' 'a-z'; }
RID=$(uuid); MID=$(uuid); CID=$(uuid); TID=$(uuid)

# Fire
curl -s -X POST http://localhost:3773/ -H 'Content-Type: application/json' \
  -d "{
    \"jsonrpc\":\"2.0\",\"method\":\"message/send\",\"id\":\"$RID\",
    \"params\":{
      \"message\":{
        \"role\":\"user\",
        \"parts\":[{\"kind\":\"text\",\"text\":\"summarize https://getbindu.com in one sentence\"}],
        \"kind\":\"message\",
        \"messageId\":\"$MID\",\"contextId\":\"$CID\",\"taskId\":\"$TID\"
      },
      \"configuration\":{\"acceptedOutputModes\":[\"application/json\"]}
    }
  }" | jq

# Pull — loop until state is completed / failed / input-required
curl -s -X POST http://localhost:3773/ -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tasks/get\",\"id\":\"$(uuid)\",\"params\":{\"taskId\":\"$TID\"}}" \
  | jq '.result | {state: .status.state, text: .artifacts[0].parts[0].text}'
```

## How it fits together

```
curl ─► Bindu HTTP (:3773) ─► ManifestWorker ─► handler(messages) ─► AIAgent.chat()
                                                                       │
                                                                       └─► Hermes tool loop
```

The handler keeps **one shared `AIAgent`** per process so Anthropic prompt
caching stays valid across turns. Bindu feeds the full history; Hermes only
sees the newest user message (Bindu is the source of truth for history,
Hermes owns the live model state for caching). Every artifact text is
DID-signed on the way out.

See [`bindu_adapter/README.md`](https://github.com/NousResearch/hermes-agent/tree/main/bindu_adapter)
in the hermes-agent repo for deeper details.
