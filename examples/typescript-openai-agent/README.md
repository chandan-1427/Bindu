# TypeScript OpenAI Agent

OpenAI SDK assistant, bindufied via the TypeScript SDK. The TS SDK spawns the Python bindu core in the background over gRPC — you write `bindufy(config, handler)` in TypeScript, the agent comes online with a DID, an A2A endpoint, and OAuth, same as a Python agent.

This example points the OpenAI SDK at OpenRouter (`baseURL: https://openrouter.ai/api/v1`) so it runs on the same key as the rest of the example fleet.

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
cd examples/typescript-openai-agent
npm install
```

## Run

```bash
npx tsx index.ts
# http://localhost:3773
```

The TS SDK launches `uv run bindu serve --grpc --grpc-port 4774` as a child. If port 4774 is taken (the gateway dev server lives there in dev), change `coreAddress` in the bindufy config to a free port.

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Reply with one plain-text sentence: capital of France?"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

> If you ask a vague open-ended question, `openai/gpt-4o-mini` sometimes replies in JSON with `{"state":"input-required","prompt":"..."}` — that's not a bug, it's the model asking for clarification, parsed by bindu's response detector into a valid `input-required` task state. Phrase prompts plainly to get a `completed` state.

With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
