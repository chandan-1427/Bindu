---
id: 2026-05-12-x402-v2-migration-hardening
title: x402 middleware rewritten on SDK v2; four payment-bypass classes closed
severity: high
status: fixed
found: 2026-04-15 (catalogued in known-issues.md)
fixed: 2026-05-12
area: bindu/server/middleware/x402
commit: (this PR)
pr:
issue:
---

## Symptom

The x402 payment middleware shipped four high-severity payment-bypass
classes, all of which lived in `bindu/server/middleware/x402/x402_middleware.py`.
Each one let an attacker (or an unlucky operator) receive paid agent
work without a valid on-chain payment. They were catalogued under
`Bindu Core (Python) → High` in `bugs/known-issues.md` as:

- `x402-middleware-fails-open-on-body-parse`
- `x402-no-replay-prevention`
- `x402-no-signature-verification`
- `x402-balance-check-skipped-on-missing-contract-code`

The four behaviors composed: an attacker who could force a parse
failure bypassed payment entirely; one who could pay once could
replay the same payload until `validBefore` elapsed; one who could
construct a forged EIP-3009 authorization for any account with a
USDC balance triggered work without ever signing anything; and an
operator pointing at a wrong asset address or a transient RPC fault
implicitly disabled the balance check.

## Root cause

All four traced back to the same architectural shape: the middleware
implemented payment validation **by hand** on top of a thin x402 SDK
(`x402==0.2.1`) that exposed primitives — `safe_base64_decode`,
`PaymentPayload`, `FacilitatorClient.verify_payment` (advisory) —
but left the operator to compose them correctly. The composition
that landed had four cracks:

1. **`except Exception: call_next(request)`** around the body parse
   block. Any exception during body decode → request flowed through
   to the agent with no payment check. The intent had been "if the
   body isn't JSON, this isn't an x402 path we care about" — but
   the path is the A2A protocol endpoint, and the failure mode is
   "let the request through unpaid."

2. **No nonce dedupe.** `(network, asset, nonce)` was extracted
   from the EIP-3009 authorization for validation but never recorded.
   The on-chain contract eventually rejects a replayed nonce at
   settlement time, but resource-server verification happens before
   settlement — so the same `X-PAYMENT` header was good for
   unlimited work within the `validBefore` window.

3. **No signature verification.** The manual `_validate_payment_manually`
   method checked scheme, amount, network, and balance — but never
   called `eth_account.Account.recover_message` or any equivalent
   to confirm that the EIP-3009 typed-data signature actually came
   from `auth.from_`. A forged authorization for any address with
   a USDC balance passed all four checks. The function's docstring
   even labeled signature verification "optional".

4. **Fail-open on missing contract code.** When `w3.eth.get_code()`
   returned empty bytes — because the asset address was wrong, or
   the RPC endpoint was misconfigured, or the chain didn't yet have
   the token deployed — the code logged `"Skipping balance check"`
   and `return True`. A misconfigured deployment silently became a
   zero-payment-required deployment.

## Fix

The structural answer is to stop hand-composing primitives and use
the SDK's resource-server abstraction instead. x402 SDK v2 introduces
`x402ResourceServer`, which owns a `FacilitatorClient`, has registered
scheme handlers, and exposes `verify_payment(payload, requirement) -> VerifyResponse`
that returns a structured result (`is_valid`, `invalid_reason`, `payer`)
and crucially does NOT raise on bad signatures — it sets `is_valid=False`
with the reason populated. The facilitator implementation runs full
EIP-3009 recovery (`mechanisms/evm/exact/facilitator.py::_verify` →
`verify_typed_data`) and the on-chain balance check, and it does so
behind a single API call we can't accidentally short-circuit.

Migrating to v2 made fixes #3 and #4 automatic. The other two needed
deliberate work:

**Fix #1 (body parse)** — narrow the exception and reject:

```python
try:
    request_data = json.loads(body.decode("utf-8"))
except (json.JSONDecodeError, UnicodeDecodeError) as e:
    return self._create_402_response("Malformed JSON-RPC body")
```

Bare `except Exception` is gone. A malformed body now returns 402
instead of falling through.

**Fix #2 (replay)** — added `NonceStore` (`bindu/server/middleware/x402/nonce_store.py`)
with two backends: `RedisNonceStore` using atomic `SET NX EX` (the
production backend), and `InMemoryNonceStore` for tests and
single-process deployments. The claim happens **before** the
facilitator call, so a replayed payload short-circuits without
paying for the facilitator round-trip:

```python
claimed = await self._nonce_store.claim(
    payload.get_network(), requirement.asset, nonce, ttl
)
if not claimed:
    return self._create_402_response("Payment nonce already used (replay)")
result = await self._resource_server.verify_payment(payload, requirement)
if not result.is_valid:
    return self._create_402_response(f"Invalid payment: {result.invalid_reason}")
```

The TTL is `requirement.max_timeout_seconds + NONCE_TTL_BUFFER_SECONDS`,
which keeps the dedupe key alive a little past the EIP-3009
`validBefore` window — covers clock skew and slow settlement.

## What this teaches

- **Don't compose security primitives by hand if the SDK ships a
  composed object.** The hand-rolled `_validate_payment_manually`
  method was the proximate cause of three of the four bugs; the
  v2 resource-server API doesn't expose the cracks because it
  doesn't expose the seams.
- **Fail-closed by default.** The original middleware had four
  failure modes that defaulted to "allow" — bare `except`, no
  nonce check (default-allow), no sig verification (default-allow),
  missing contract code (default-allow). Each one was individually
  small; together they collapsed payment enforcement entirely.
  Every new check we added in this rewrite returns 402 on
  uncertainty.
- **Nonce dedupe is the operator's job, not the chain's.** EIP-3009
  rejects replayed nonces at settlement — but verification happens
  before settlement, and resource servers are the layer that
  decides whether to run the work. The chain protects against
  double-charging; it doesn't protect against double-work.
- **Dependency pins that go stale are a security surface.** `x402==0.2.1`
  was pinned in May 2026 and never moved; the v2 line had been out
  for months when we noticed. The Dependabot alert for
  GHSA-on-x402 was the prompt — but the four bugs we cleared under
  it were ours, not the SDK's.

## Test coverage added

`tests/unit/server/middleware/x402/test_x402_middleware.py` exercises
each invariant end-to-end with a mocked `x402ResourceServer`:

- `TestBodyParseFailure::test_malformed_json_returns_402`
- `TestBodyParseFailure::test_invalid_utf8_returns_402`
- `TestReplayPrevention::test_same_payload_replayed_is_rejected`
  (asserts the facilitator was called exactly once — the replay
  short-circuited at the nonce check, not after verification)
- `TestReplayPrevention::test_different_nonces_both_succeed`
- `TestFacilitatorRejection::test_invalid_payment_returns_402`
- `TestNoncelessPayload::test_payload_without_nonce_is_rejected`

`tests/unit/server/middleware/x402/test_nonce_store.py` covers the
nonce store directly: key namespacing across (network, asset),
concurrent-claim resolution, TTL expiry.
