# Bindu Communications

The human-visible layer of secured A2A communication.

Three-pane operator/auditor/developer surface for watching agent-to-agent traffic land, verify, and settle. Each row in the stream is a signed exchange between two DIDs; the right rail lets you glance, verify the crypto, or inspect the raw payload.

This is a **visual prototype** — mock data, no backend wired up yet. The next step is plumbing it to Bindu's push-notification webhook + the gateway's `/plan` SSE.

## Run it

```bash
cd bindu-communication
npm install
npm run dev
```

Opens at http://127.0.0.1:3775. (3773 = bindufy agents, 3774 = gateway, 3775 = this UI; the API stays on 3787, proxied via `/api/*`.)

## Stack

- React 19 + React Router v7 (SPA mode)
- Vite 6
- Tailwind v4 (CSS-based config)
- TanStack Query (ready for when we wire real data)
- Zustand (UI state)
- Phosphor icons

## What's in the box

- **Sidebar** — agents you operate + scope filters
- **Stream** — newest first, pinned *Needs Attention* lane above the live feed
- **Detail rail** — three depth tabs per event:
  - **Glance** — who/what/when + action buttons (operator)
  - **Verify** — signature, DID doc, key match, nonce (auditor)
  - **Inspect** — raw JSON-RPC payload + timing + request ID (developer)

Mock data covers the walkthrough scenario: `news-curator` (untrusted, first contact) commissions a 500-word blog post from `writer-agent`, negotiation reaches 5 USDC, you approve, work happens, signed artifact delivers. Plus one currently-pending `input-required` row on `research-agent` so you can see what an actionable card looks like, and one gateway plan with three child A2A calls so you can see the trace-expansion pattern.

## Attribution

Visual aesthetic inspired by [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox) (Apache 2.0). See [NOTICE](./NOTICE).
