# Cybersecurity Newsletter

A research agent that scans the web for the latest cybersecurity news + CVEs and assembles a short newsletter on whatever topic you ask about. Agno + OpenRouter (`openai/gpt-oss-120b`) + DuckDuckGo for search.

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
uv sync --extra agents
```

## Run

```bash
uv run examples/cybersecurity-newsletter/cybersecurity_newsletter_agent.py
# http://localhost:3773
```

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Recent supply-chain attacks on npm packages"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

Then `tasks/get` for the newsletter — headlines, brief summaries, and any CVE references the search surfaced. With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
