# Keeping your skill menu private

Your agent advertises its skills the moment it boots. Anyone hitting
`/.well-known/agent.json` sees the full list — name, description,
everything. That's perfect for an open research agent that wants to be
found. It's a disaster for a commercial agent where the skill
descriptions ARE the product.

Picture you've built a compliance agent. Its real value isn't *"I do
classification"* (everyone does classification). It's *"I classify HS
codes for steel imports into the EU under CBAM transitional rules,
using our internal cross-reference of emission factors and supplier
tonnage."* That sentence is your roadmap. Sitting plaintext on a public
URL, it's also your competitor's roadmap.

What you want is two views of the same agent:

- **A public view** — generic. "We do compliance." Routing gateways
  can still find you ("send compliance work this way") without
  learning what you actually do well.
- **A partner view** — your real menu, but only to wallets you've
  pre-approved.

That's what `private_skills` + `allowed_dids` give you.

## The five-second picture

```
Public web crawler                            Allowlisted partner agent
       │                                              │
       ▼                                              ▼
 /.well-known/agent.json                       /agent/private.json
       │                                              │
       ▼                                              ▼
  ┌────────┐                                  ┌───────────────────┐
  │ skills │                                  │ skills            │
  │  only  │   ← same agent, two surfaces →   │ + private_skills  │
  └────────┘                                  └───────────────────┘
```

The split is **per-skill, in the agent's config**. Public skills go in
`skills:`. Private skills go in `private_skills:`. The agent reads both,
exposes only the public list on the well-known URL, and stands the
private list up at a second URL behind a two-layer gate.

## Turning it on — the smallest possible config

Add three things to your existing agent config: two more skill paths,
one allowlist of DIDs.

```python
config = {
    "author": "you@example.com",
    "name": "acme_compliance_agent",
    "deployment": {"url": "http://localhost:3773"},

    "skills": [
        "skills/public-greet",
        "skills/public-status",
    ],

    # ─── The new bit ───────────────────────────────────────────────
    "private_skills": [
        "skills/cbam-line-classify",
        "skills/eudr-due-diligence",
    ],
    "allowed_dids": [
        "did:bindu:partner-bank:agent:abc123",
        "did:bindu:partner-customs-broker:agent:def456",
    ],
    # ───────────────────────────────────────────────────────────────
}
```

On disk, public and private skills look identical — each one is a
folder under `skills/` with a `skill.yaml` describing it. The split
between public and private is purely a config-level decision. You can
move a skill from public to private (or back) by editing two lines of
config.

When neither `private_skills` nor `allowed_dids` is set, **nothing
changes**. The private endpoint isn't even registered. Existing agents
are unaffected — this feature is opt-in.

## How the gate actually works

Two layers stand between an HTTP request and the private catalog:

1. **Hydra middleware.** This is the same authentication layer Bindu
   uses for paid endpoints today. It verifies the OAuth bearer token,
   verifies the request was signed with the matching DID's private key,
   and rejects unauth at 401. If the request makes it past this, we
   know who's calling.

2. **The allowlist.** Even an authenticated DID isn't automatically
   trusted with your private catalog. The handler compares the caller's
   DID against `manifest.allowed_dids`. If it's not in there, 403.

In other words: knowing who you are isn't enough — you also have to be
on the list.

## Try every path

Once the agent's running, hit it with `curl` and walk through what each
state looks like. The runnable example at
[`examples/private_skills_agent/`](../examples/private_skills_agent/)
sets all this up — boot it with:

```bash
uv run python examples/private_skills_agent/acme_compliance_agent.py
```

### "I'm a random web crawler"

```bash
curl -s http://localhost:3773/.well-known/agent.json | jq '.skills[].id'
```

```
"public-greet"
"public-status"
```

Two skills. The CBAM and EUDR skills you configured don't appear. As
far as the public web is concerned, this agent does some kind of
greeting and reports status.

### "I'm an outsider trying to peek behind the curtain"

```bash
curl -s -w "%{http_code}\n" http://localhost:3773/agent/private.json
```

```
{"error":"Authentication required for private agent card"}
401
```

The route exists (it's not 404 — that would tell you the feature isn't
configured), but the handler refuses without auth.

### "I have a valid DID, but I'm not your partner"

If you point a Hydra-issued caller at the endpoint with a valid bearer
+ signed request, but the caller's DID isn't in `allowed_dids`, you
get:

```
{"error":"DID not authorized for this agent's private skills"}
403
```

And the server logs:

```
WARN  private_catalog_access caller=did:bindu:somebody-else:agent:xyz
                              ip=10.0.0.7
                              result=denied reason=not_in_allowlist
```

The signature was valid. The DID just isn't on the list. You won't be
able to brute-force your way in — there's nothing to guess.

### "I'm Bob, your allowlisted partner"

When Bob's DID matches one of the entries in `allowed_dids`, the
response is the merged catalog — same envelope as the public agent
card, just with more skills:

```json
{
  "id": "...",
  "name": "acme_compliance_agent",
  "skills": [
    {"id": "public-greet",       "name": "greet"},
    {"id": "public-status",      "name": "status"},
    {"id": "cbam-line-classify", "name": "cbam-line-classify"},
    {"id": "eudr-due-diligence", "name": "eudr-due-diligence"}
  ]
}
```

And the audit log records the access:

```
INFO  private_catalog_access caller=did:bindu:partner-bank:agent:abc123
                             ip=10.0.0.5
                             result=granted
```

Bob now knows what you can do for him. The web crawler still doesn't.

## Operator workflow

Most of the day-2 work with this feature is small. There's no key
ceremony, no certificate rotation, no manifest re-encryption.

**Onboarding a partner.** Get their DID. Add it to `allowed_dids` in
your config. Restart the agent. Their next handshake succeeds.

**Removing a partner.** Delete their DID from the list. Restart. Their
next request fails at the allowlist check. No race window, no key to
chase.

**Audit trail.** Every authenticated request to `/agent/private.json`
produces a structured log entry — `caller=`, `ip=`, `result=`,
`reason=`. Grep for `private_catalog_access` to see exactly who's been
looking and when. Useful for quarterly compliance reviews ("show me who
saw our IP this period") and for spotting reconnaissance attempts.

## When to use this — and when it's overkill

**You probably want this if:**

- Your agent is a commercial product where the skill descriptions
  reveal your roadmap (compliance, financial signals, security
  research, anything proprietary).
- You're selling to partners under contracts that include "competitors
  can't see our capabilities."
- You want tier-based discovery — gold partners see the full menu;
  trial users see only the public preview.

**You don't need this if:**

- Your agent is meant to be discovered. Open research, demo agents,
  community tools — you WANT to be on the public catalog.
- You're behind a corporate firewall and only your own agents can reach
  the URL anyway.
- You're early-stage and any discovery is good discovery.

## What this doesn't protect against

Be honest with yourself about the threat model. The auth-gated endpoint
defends against:

| Threat | Protected? |
|---|---|
| Random web crawler indexing your menu | **Yes** |
| Unauthenticated peer hitting the private URL | **Yes** |
| Authenticated peer whose DID isn't on your list | **Yes** |

It does NOT defend against:

| Threat | Why not |
|---|---|
| You (the operator) reading the private skills | They sit plaintext in your config file. You wrote them. |
| An authorized partner re-publishing your catalog elsewhere | Once they've seen it, you can't take it back. Use partner agreements with NDAs to address this layer. |
| Database backups containing skill descriptions | Same reason — the data is plaintext on disk by design. |
| Operator-untrusted environments (multi-tenant PaaS) | If you can't trust whoever runs the server, this isn't enough. That's a different feature (encryption at rest with per-partner JWE envelopes) and a different conversation. |

For self-hosted Bindu deployments, the gate is enough. For enterprise
deployments under strict SOC2 controls, talk to us before shipping —
the encryption-at-rest story is a Phase 2 that hasn't been built yet
because nobody's asked for it.

## Where to look in the code

If you want to read the actual implementation:

- The handler:
  [`bindu/server/endpoints/private_agent_card.py`](../bindu/server/endpoints/private_agent_card.py)
- Config plumbing (where `private_skills` and `allowed_dids` get
  loaded): [`bindu/penguin/bindufy.py`](../bindu/penguin/bindufy.py)
  (search for `private_skills`)
- Manifest fields:
  [`bindu/common/models.py`](../bindu/common/models.py) (`AgentManifest`)
- Tests, which double as the most accurate spec:
  [`tests/unit/server/endpoints/test_private_agent_card.py`](../tests/unit/server/endpoints/test_private_agent_card.py)
- A runnable example:
  [`examples/private_skills_agent/`](../examples/private_skills_agent/)

## Related

- [`SKILLS.md`](./SKILLS.md) — the underlying skill system that both
  public and private skills are built on.
- [`AUTHENTICATION.md`](./AUTHENTICATION.md) — how the Hydra-based
  auth layer that gates this endpoint works.
- [`bugs/known-issues.md`](../bugs/known-issues.md) — current
  limitations across Bindu.
