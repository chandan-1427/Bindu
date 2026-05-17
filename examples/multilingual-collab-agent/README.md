# Multilingual Collab Agent

Detects what language you wrote in (English, Hindi, Bengali) and replies in the same language. Persistent memory via Mem0, so it actually remembers what you told it across sessions. Agno + OpenRouter (`openai/gpt-4o-mini`).

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
export MEM0_API_KEY=<get one at https://app.mem0.ai/dashboard/api-keys>
uv sync --extra agents
```

Without `MEM0_API_KEY` the task ends in `failed` with `MEM0_API_KEY environment variable is required` — Mem0 is wired into the handler, not optional.

## Run

```bash
uv run examples/multilingual-collab-agent/main.py
# http://localhost:3773
```

## Talk to it

With `AUTH__ENABLED=false`, in English:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Hello, are you alive?"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

In Bengali, same body shape — just swap the `text` to বাংলা. The agent picks up the language and answers in kind.

With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
