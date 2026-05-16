#!/usr/bin/env bash
# hydra_smoke_test.sh — prove the Hydra-protected agent round-trip end-to-end.
#
# Prerequisites:
#   1. examples/.env has AUTH__ENABLED=true (already done).
#   2. The fleet agents have been restarted at least once with auth on,
#      so each one has auto-registered itself in Hydra and persisted its
#      client credentials to <agent_cwd>/.bindu/oauth_credentials.json.
#   3. The Hydra public token endpoint is reachable from this machine.
#
# What it proves:
#   A. Public endpoint (/agent/skills) → 200, no bearer needed.
#   B. Protected endpoint (POST /, message/send) → 401 without bearer.
#   C. With a fresh client_credentials token → 200 + Task in response.
#
# Why borrow an agent's credentials instead of registering a separate
# OAuth client: the auto-registered agents are the only clients we
# know exist on this Hydra without manual setup. Any of their tokens
# is a valid bearer for every other agent's protected endpoints (auth
# is "valid token from this Hydra", not "token bound to a specific
# agent"). For a dedicated client, register one via Hydra admin and
# set CLIENT_ID / CLIENT_SECRET env vars to override.

set -euo pipefail

# --- config ----------------------------------------------------------
HYDRA_TOKEN_URL="${HYDRA_TOKEN_URL:-https://hydra.getbindu.com/oauth2/token}"
AGENT_URL="${AGENT_URL:-http://localhost:5778}"     # bindu_docs_agent
CREDS_FILE="${CREDS_FILE:-$(pwd)/.bindu/oauth_credentials.json}"

# --- color helpers ---------------------------------------------------
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
gray()  { printf "\033[90m%s\033[0m\n" "$*"; }
bold()  { printf "\033[1m%s\033[0m\n" "$*"; }

# --- load credentials -----------------------------------------------
if [[ -n "${CLIENT_ID:-}" && -n "${CLIENT_SECRET:-}" ]]; then
  gray "Using CLIENT_ID/CLIENT_SECRET from env"
elif [[ -f "$CREDS_FILE" ]]; then
  gray "Reading credentials from $CREDS_FILE"
  # Pick the first DID's credentials. Multiple agents can share a creds file.
  CLIENT_ID="$(jq -r 'to_entries[0].value.client_id' "$CREDS_FILE")"
  CLIENT_SECRET="$(jq -r 'to_entries[0].value.client_secret' "$CREDS_FILE")"
else
  red "✗ No credentials. Set CLIENT_ID + CLIENT_SECRET env vars, or run from a directory containing .bindu/oauth_credentials.json"
  exit 1
fi

if [[ "$CLIENT_ID" == "null" || -z "$CLIENT_ID" ]]; then
  red "✗ Failed to extract client_id from $CREDS_FILE"
  exit 1
fi
gray "Client ID: ${CLIENT_ID:0:60}…"

# --- A. public endpoint, no bearer ----------------------------------
bold "A. Public endpoint /agent/skills (expect 200, no bearer)"
A_CODE=$(curl -sS -o /tmp/hydra_smoke_A.json -w "%{http_code}" "$AGENT_URL/agent/skills")
if [[ "$A_CODE" == "200" ]]; then
  green "  ✓ 200"
  gray  "  skills: $(jq -r '[.[].id] | join(", ")' /tmp/hydra_smoke_A.json 2>/dev/null || cat /tmp/hydra_smoke_A.json)"
else
  red "  ✗ got $A_CODE"; cat /tmp/hydra_smoke_A.json; exit 1
fi

# --- B. protected endpoint, no bearer -------------------------------
bold "B. POST / (message/send) without bearer (expect 401)"
B_CODE=$(curl -sS -o /tmp/hydra_smoke_B.json -w "%{http_code}" \
  -X POST "$AGENT_URL/" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"smoke","method":"message/send","params":{"message":{"role":"user","kind":"message","parts":[{"kind":"text","text":"hi"}],"messageId":"smoke-msg"},"configuration":{"acceptedOutputModes":["application/json"]}}}')
if [[ "$B_CODE" == "401" || "$B_CODE" == "403" ]]; then
  green "  ✓ $B_CODE (auth gate is active)"
else
  red "  ✗ expected 401, got $B_CODE"; cat /tmp/hydra_smoke_B.json; exit 1
fi

# --- C. fetch token via client_credentials --------------------------
# Bindu agents auto-register with `token_endpoint_auth_method =
# client_secret_post` (see bindu/auth/hydra/registration.py:247), so
# client_id / client_secret go in the form body — NOT as HTTP Basic.
# Scope set matches docs/AUTHENTICATION.md's example.
bold "C. Fetching token from $HYDRA_TOKEN_URL via client_credentials"
TOKEN_RESPONSE=$(curl -sS -X POST "$HYDRA_TOKEN_URL" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode "scope=openid offline agent:read agent:write")
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')
if [[ "$ACCESS_TOKEN" == "null" || -z "$ACCESS_TOKEN" ]]; then
  red "  ✗ token fetch failed:"; echo "$TOKEN_RESPONSE" | jq . 2>/dev/null || echo "$TOKEN_RESPONSE"; exit 1
fi
green "  ✓ token obtained (${#ACCESS_TOKEN} chars)"

# --- D. DID-sign the body + call with bearer + signature -----------
# DID-protected agents enforce TWO layers: Hydra bearer (answers "are
# you allowed") + Ed25519 DID signature (answers "are you who you
# claim"). The signature canonicalization must match
# bindu/utils/did/signature.py:create_signature_payload —
#   payload = json.dumps({"body": <raw>, "did": <did>, "timestamp": <unix>}, sort_keys=True)
# and the signature is base58-encoded Ed25519.
PRIV_KEY="${PRIV_KEY:-$(dirname "$CREDS_FILE")/private.pem}"
if [[ ! -f "$PRIV_KEY" ]]; then
  red "✗ No private key at $PRIV_KEY (needed for X-DID-Signature)"; exit 1
fi

# Real UUIDs — bindu validates id / messageId / contextId / taskId as
# UUID4 (Pydantic types), so smoke-test placeholders 4xx at JSON-RPC
# parse. uuidgen is on every macOS / most Linux distros; if missing,
# substitute `python -c "import uuid; print(uuid.uuid4())"`.
RPC_ID=$(uuidgen | tr 'A-Z' 'a-z')
MSG_ID=$(uuidgen | tr 'A-Z' 'a-z')
CTX_ID=$(uuidgen | tr 'A-Z' 'a-z')
TASK_ID_NEW=$(uuidgen | tr 'A-Z' 'a-z')
BODY="{\"jsonrpc\":\"2.0\",\"id\":\"$RPC_ID\",\"method\":\"message/send\",\"params\":{\"message\":{\"role\":\"user\",\"kind\":\"message\",\"parts\":[{\"kind\":\"text\",\"text\":\"What is Bindu?\"}],\"messageId\":\"$MSG_ID\",\"contextId\":\"$CTX_ID\",\"taskId\":\"$TASK_ID_NEW\"},\"configuration\":{\"acceptedOutputModes\":[\"application/json\"]}}}"

# Self-call: the request claims to be FROM the agent itself (DID
# matches client_id), so the verifier looks up this same DID in Hydra
# and finds the public_key we registered at boot. Real-world callers
# would use their OWN DID + private key here.
bold "D. DID-sign the body via $PRIV_KEY"
SIG_OUT=$(BODY="$BODY" DID="$CLIENT_ID" PRIV="$PRIV_KEY" uv run python - <<'PY' 2>&1
import json, os, time
from cryptography.hazmat.primitives.serialization import load_pem_private_key
import base58

priv = load_pem_private_key(open(os.environ["PRIV"], "rb").read(), password=None)
ts = int(time.time())
payload_str = json.dumps(
    {"body": os.environ["BODY"], "did": os.environ["DID"], "timestamp": ts},
    sort_keys=True,
)
sig_bytes = priv.sign(payload_str.encode("utf-8"))
sig_b58 = base58.b58encode(sig_bytes).decode("ascii")
# Print three lines stdout consumes verbatim.
print(f"TS={ts}")
print(f"SIG={sig_b58}")
PY
)
TS=$(echo "$SIG_OUT" | sed -n 's/^TS=//p')
SIG=$(echo "$SIG_OUT" | sed -n 's/^SIG=//p')
if [[ -z "$TS" || -z "$SIG" ]]; then
  red "✗ DID signing failed:"; echo "$SIG_OUT"; exit 1
fi
green "  ✓ signed (sig=${SIG:0:24}…, ts=$TS)"

bold "E. POST / with bearer + DID signature (expect 200)"
E_CODE=$(curl -sS -o /tmp/hydra_smoke_E.json -w "%{http_code}" \
  -X POST "$AGENT_URL/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-DID: $CLIENT_ID" \
  -H "X-DID-Timestamp: $TS" \
  -H "X-DID-Signature: $SIG" \
  --data-raw "$BODY")
if [[ "$E_CODE" == "200" ]]; then
  green "  ✓ 200"
  TASK_ID=$(jq -r '.result.id // empty' /tmp/hydra_smoke_E.json 2>/dev/null)
  STATE=$(jq -r '.result.status.state // empty' /tmp/hydra_smoke_E.json 2>/dev/null)
  gray "  task_id: $TASK_ID  state: $STATE"
else
  red "  ✗ got $E_CODE"; cat /tmp/hydra_smoke_E.json; exit 1
fi

echo
green "All checks passed. Hydra bearer + DID-sig round-trip is working."
