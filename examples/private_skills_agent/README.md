# Private Skills (ACME Compliance)

A demo of bindu's private-skills surface: the public `/.well-known/agent.json` advertises the generic skills (`greet`, `status`), but the agent also carries a **private** skill catalog at `/agent/private.json` that's only readable by DIDs in `allowed_dids`. The handler is a stub echo — the point is the access shape, not the response.

## Setup

```bash
uv sync --extra agents
```

No LLM, no API key — pure protocol demo.

## Run

```bash
uv run examples/private_skills_agent/acme_compliance_agent.py
# http://localhost:3773
```

## What to look at

Two endpoints serve the same agent at different visibility:

| Endpoint | Visibility | Returns |
| --- | --- | --- |
| `GET /.well-known/agent.json` | Public, unauthenticated | Generic skills (`greet`, `status`) |
| `GET /agent/private.json` | Hydra OAuth + DID in `allowed_dids` | The real catalog (`cbam_assessment`, `eudr_check`) |

The private surface is gated by the same auth stack the rest of bindu uses — see [`docs/AUTH.md`](../../docs/AUTH.md). Hitting `/agent/private.json` without a token (or from a DID not in the allowlist) returns 401/403.

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"hello"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
# → acme_compliance_agent: received 'hello'
```

Auth-off skips the gate; you won't see the private surface enforced. Re-run with `AUTH__ENABLED=true` (and an allowed-DID-signed request) to exercise the gate proper.
