# Notte Browser

Tell it to "visit X and tell me Y" and it actually drives a headless browser to do it. Notte runs the browser + reasoning loop; bindu wraps it as an A2A agent. There's no separate LLM-plus-tools layer — Notte is the agent.

## Setup

```bash
export NOTTE_API_KEY=<get one at https://console.notte.cc>
uv sync --extra agents
uv pip install notte-sdk
```

`notte-sdk` isn't in the `agents` extra — install it explicitly or boot fails on `AuthenticationError`.

Optional: `NOTTE_REASONING_MODEL=anthropic/claude-sonnet-4-5` (or `openai/gpt-4.1`) to escalate the model for harder multi-step flows. Default is whatever Notte picks.

## Run

```bash
uv run examples/notte-browser-agent/notte_browser_agent.py
# http://localhost:3773
```

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Visit https://example.com and tell me the page title in one sentence."}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

Each request gets its own browser context (Notte sessions are scoped per call). Expect 10–30s task duration for multi-step flows. With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
