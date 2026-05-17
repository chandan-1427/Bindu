# TypeScript LangChain Quiz Agent

Hand it a chunk of source text, get back a 10-question MCQ quiz. LangChain.js + OpenRouter (`openai/gpt-oss-120b`) under a system prompt that enforces "10 MCQs, 4 options each, single correct answer, 1-sentence explanation".

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
cd examples/typescript-langchain-quiz-agent
npm install
```

## Run

```bash
npx tsx quiz-agent.ts
# http://localhost:3773
```

Entry is `quiz-agent.ts`, not `index.ts`. The TS SDK spawns `uv run bindu serve --grpc --grpc-port 4774` as a child — change `coreAddress` in the bindufy config if 4774 is taken.

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Generate a quiz from this text: The mitochondrion is the powerhouse of the cell."}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

Then `tasks/get` — the artifact is a markdown-formatted 10-question quiz with answer key and explanations.

With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
