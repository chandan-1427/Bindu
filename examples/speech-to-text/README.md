# Speech-to-Text

Transcribe audio files via Google's Gemini 2.0 Flash, routed through OpenRouter. Hand it a path to a `.mp3`, `.wav`, `.ogg`, or `.m4a` and you get back a transcript (plus, optionally, a summary).

## Setup

```bash
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
uv sync --extra agents
```

## Run

```bash
uv run examples/speech-to-text/speech_to_text_agent.py
# http://localhost:3773
```

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Transcribe /absolute/path/to/clip.mp3"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

Two ways to feed audio:
- **By path** (above): the agent reads the file off the host filesystem. Easiest for local testing.
- **As a `file` part** with base64 bytes: same shape as `document-analyzer`. See [`docs/FILE_HANDLING_&_UPLOADS.md`](../../docs/FILE_HANDLING_&_UPLOADS.md).

With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
