# Hermes-Agent via Bindu

Run [hermes-agent](https://github.com/NousResearch/hermes-agent) — a
tool-using coding / research agent with web, file, and code-exec tools —
as a Bindu A2A microservice. One file, two dependencies, self-contained.

Behind Bindu you get: DID identity, A2A JSON-RPC on `:3773`, optional
OAuth2 auth, x402 payments, and a public FRP tunnel.

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- `OPENROUTER_API_KEY` (or another provider key your chosen model uses)

## Run

Hermes-agent is not on PyPI yet — install directly from GitHub:

```bash
uv pip install bindu "hermes-agent @ git+https://github.com/NousResearch/hermes-agent.git"

cp .env.example .env
$EDITOR .env                       # set OPENROUTER_API_KEY

python hermes_simple_example.py
```

Or with a throw-away isolated env (no global install):

```bash
uv run --python 3.12 \
  --with bindu \
  --with "hermes-agent @ git+https://github.com/NousResearch/hermes-agent.git" \
  python hermes_simple_example.py
```

The first-line banner will show your agent's DID and the `http://localhost:3773`
endpoint.

## Safety tiers

`HERMES_TIER` gates which Hermes toolsets are exposed. Hermes has ~20
toolsets including terminal and code execution — pick the tier matching
your deployment:

| `HERMES_TIER` | Toolsets | When |
|---|---|---|
| `read` (default) | `web` (search + extract) | Public / tunneled |
| `sandbox` | `web` + `file` + `moa` | Trusted caller, local FS ok |
| `full` | everything (terminal, browser, code-exec, MCP) | Localhost only |

**Never combine `full` with a public tunnel.** That's RCE-as-a-service.

## Fire and pull

The protocol is standard A2A JSON-RPC — see the authoritative
[openapi.yaml](https://github.com/raahulrahl/docs/blob/main/openapi.yaml).
All IDs must be real UUIDs; `tasks/get` keys off `taskId` (not `id`).

```bash
uuid() { uuidgen | tr 'A-Z' 'a-z'; }
RID=$(uuid); MID=$(uuid); CID=$(uuid); TID=$(uuid)

# Fire — returns immediately with state: submitted + taskId
curl -s -X POST http://localhost:3773/ -H 'Content-Type: application/json' \
  -d "{
    \"jsonrpc\":\"2.0\",\"method\":\"message/send\",\"id\":\"$RID\",
    \"params\":{
      \"message\":{
        \"role\":\"user\",
        \"parts\":[{\"kind\":\"text\",\"text\":\"summarize bindu in one sentence\"}],
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

Other methods on the same endpoint: `tasks/list`, `tasks/cancel`,
`contexts/list`, `tasks/pushNotificationConfig/set` (webhooks),
`message/stream` (SSE).

## How it fits together

```
curl ─► Bindu HTTP (:3773) ─► ManifestWorker ─► handler(messages)
                                                    │
                                                    ▼
                                            AIAgent.chat(last_user_text)
                                                    │
                                                    └─► Hermes tool loop
```

The handler keeps **one shared `AIAgent`** per process so Anthropic prompt
caching stays valid across turns. Bindu feeds the full history; the handler
only passes the newest user message into Hermes (Bindu is the source of
truth for history; Hermes owns the live model state for caching).

Every artifact text part returned by Bindu is DID-signed on the way out.
