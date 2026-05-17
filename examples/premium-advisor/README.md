# Premium Advisor

The smallest possible example of an x402-paywalled agent: 0.01 USDC on Base Sepolia per question, and you get a market-insight reply only after the payment lands. Agno + OpenRouter behind the gate.

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
uv sync --extra agents
```

To actually pay the agent you need a wallet with Base Sepolia USDC. The configured `pay_to_address` in `premium_advisor.py` is a demo dummy — edit it before pointing real money at it.

## Run

```bash
uv run examples/premium-advisor/premium_advisor.py
# http://localhost:3773
```

## Talk to it

A request without payment headers gets a 402 with the price quote:

```bash
curl -i http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Is now a good time to buy ETH?"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
# HTTP/1.1 402 Payment Required
# {"x402Version":2,"error":"X-PAYMENT header required",
#  "accepts":[{"amount":"10000","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e", ...}]}
```

That 402 IS the working state — the paywall is doing its job. To actually unblock the agent, sign a USDC transfer and resend with `X-PAYMENT: <signed-payload>`. The x402 spec is at <https://github.com/coinbase/x402>; bindu's payment middleware lives at `bindu/server/middleware/x402/`.

For the auth-on flow (Hydra OAuth + DID-signed bodies), see [`docs/AUTH.md`](../../docs/AUTH.md). The paywall and the auth gate stack — both have to pass.
