# Kotlin OpenAI Agent

Kotlin assistant bindufied via the [Bindu Kotlin SDK](../../sdks/kotlin/). The Kotlin SDK spawns the Python bindu core in the background over gRPC — you write `bindufy(config, handler)` in Kotlin and the agent comes online with a DID, an A2A endpoint, and OAuth, same shape as the Python and TypeScript examples.

Points at OpenRouter so the example fleet runs on a single key.

## Setup

```bash
brew install openjdk@17     # Gradle's jvmToolchain is set to 17
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$PATH"
export OPENROUTER_API_KEY=<get one at https://openrouter.ai/keys>
```

You also need `gradle` on your PATH (`brew install gradle`). The example uses Gradle's [composite-build](https://docs.gradle.org/current/userguide/composite_builds.html) — the included `settings.gradle.kts` points at `../../sdks/kotlin/` so Gradle resolves `com.getbindu:bindu-sdk` from the sibling SDK source tree.

## Run

```bash
cd examples/kotlin-openai-agent
gradle --no-daemon run
# http://localhost:3773
```

First boot takes ~30s while Gradle resolves the SDK + compiles. The Kotlin SDK spawns `uv run bindu serve --grpc --grpc-port 4774` as a child — change `coreAddress` in `Main.kt` if 4774 is taken.

## Talk to it

With `AUTH__ENABLED=false`:

```bash
curl -sS http://localhost:3773/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Reply with one plain-text sentence: capital of Germany?"}],"kind":"message","messageId":"m1","contextId":"c1","taskId":"t1"}}}'
```

With auth on, sign each body with the agent's DID key — see [`docs/AUTH.md`](../../docs/AUTH.md).
