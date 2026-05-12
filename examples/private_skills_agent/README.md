# Private skills — ACME Compliance example

This example shows how to keep your agent's commercially-sensitive skills
out of the public catalog while still letting authorized partner agents
discover them.

## The story

You've built a compliance agent. Its real value isn't "I do classification"
(everyone does that) — it's the specific things you do well: CBAM line
classification under EU transitional rules, EUDR due-diligence statements
for cocoa/coffee/timber. Those skill descriptions are essentially your
product roadmap. Anyone scraping bindufied agents on the open web shouldn't
be reading your menu.

What you want is two views of the same agent:

- **Public** — generic. "We do compliance." That's it.
- **Partner** — your full menu, but only to wallets you've allowlisted.

That's what `private_skills` + `allowed_dids` give you.

## How the config splits public from private

```python
config = {
    "skills": [
        "skills/public-greet",     # ← in /.well-known/agent.json
        "skills/public-status",    # ← in /.well-known/agent.json
    ],
    "private_skills": [
        "skills/cbam-line-classify",      # ← only in /agent/private.json
        "skills/eudr-due-diligence",      # ← only in /agent/private.json
    ],
    "allowed_dids": [
        "did:bindu:partner-bank:agent:abc123",
        "did:bindu:partner-customs-broker:agent:def456",
    ],
}
```

The folder layout follows the same pattern as Bindu's other skill loading
— one directory per skill, each with a `skill.yaml`. The split between
public and private is purely a config-level decision; on disk the four
skill folders look identical.

## Run it

```bash
uv run python examples/private_skills_agent/acme_compliance_agent.py
```

The agent boots on `http://localhost:3773`. No API keys required — the
handler is an echo so you can focus on the paywall shape.

## Try every path

### 1. Public catalog — anyone gets this

```bash
curl -s http://localhost:3773/.well-known/agent.json | jq '.skills[].id'
```

```
"public-greet"
"public-status"
```

The two private skills are nowhere. A web crawler hitting this URL learns
that ACME Compliance is "a compliance agent" and nothing more.

### 2. Private catalog, no auth — refused

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3773/agent/private.json
```

```
401
```

Body: `{"error": "Authentication required for private agent card"}`.

### 3. Private catalog, authenticated but not allowlisted — refused

If you point a Hydra-issued caller at the endpoint with a valid bearer +
DID signature but the caller's DID isn't in `allowed_dids`, you get **403**:

```
{"error": "DID not authorized for this agent's private skills"}
```

### 4. Private catalog, allowlisted partner — full menu

When the caller's DID matches one of the allowlist entries, the response
is the merged catalog:

```json
{
  "skills": [
    {"id": "public-greet",       "name": "greet",                ...},
    {"id": "public-status",      "name": "status",               ...},
    {"id": "cbam-line-classify", "name": "cbam-line-classify",   ...},
    {"id": "eudr-due-diligence", "name": "eudr-due-diligence",   ...}
  ]
}
```

Same envelope as the public agent card; just longer.

## Server-side log line

Every authenticated request to `/agent/private.json` produces a structured
log entry — so you have an audit trail for compliance reviews:

```
INFO  private_catalog_access caller=did:bindu:partner-bank:agent:abc123 ip=10.0.0.5 result=granted
WARN  private_catalog_access caller=did:bindu:somebody-else:agent:xyz   ip=10.0.0.7 result=denied reason=not_in_allowlist
```

Grep for `private_catalog_access` in your agent logs to see who's been
looking.

## Adding or removing a partner

Add a partner: append their DID to `allowed_dids` in your config, restart
the agent. They can hit the endpoint immediately.

Remove a partner: delete the entry, restart. Their next handshake fails
at the allowlist check. There's no key rotation to coordinate — the
allowlist is the whole gate.

## What this does NOT protect against

Be honest with yourself about the threat model. The auth-gated endpoint
defends against:

- Random web crawlers indexing your menu — yes ✓
- Unauthenticated peers discovering the catalog — yes ✓
- Authenticated peers without the right DID — yes ✓

It does NOT defend against:

- The operator (you) reading the private skills — you have the config file
- An authorized partner re-publishing the catalog — handle this with
  partner agreements, not crypto
- Database backups containing skill descriptions — the skills sit
  plaintext in your config, so anything that reads your filesystem reads
  the skills

If you need "the server itself can't read these," that's a different
feature (JWE encryption at rest) and a different conversation. For most
deployments — including the one in this example — the gate is enough.

## Where to look in the code

- Handler: [`bindu/server/endpoints/private_agent_card.py`](../../bindu/server/endpoints/private_agent_card.py)
- Config plumbing: [`bindu/penguin/config_validator.py`](../../bindu/penguin/config_validator.py)
  (search for `private_skills`)
- Tests, which double as the most accurate spec:
  [`tests/unit/server/endpoints/test_private_agent_card.py`](../../tests/unit/server/endpoints/test_private_agent_card.py)
