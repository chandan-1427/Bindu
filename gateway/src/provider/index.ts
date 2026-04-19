import { Context, Effect, Layer } from "effect"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"
import { Service as ConfigService, type Config } from "../config"
import type { z } from "zod"

/**
 * Provider service — OpenRouter-only.
 *
 * Looks up an AI-SDK LanguageModel handle by ``"openrouter/<modelId>"``
 * where ``modelId`` is whatever OpenRouter publishes for that model
 * (for example ``openai/gpt-4o-mini`` or
 * ``anthropic/claude-sonnet-4.5``).
 *
 * Why a single provider: we ship every agent (gateway planner + the
 * fleet) on OpenRouter. Supporting the Anthropic or OpenAI SDKs
 * directly was optionality nobody used and added two env vars and a
 * dependency we could drop. OpenRouter exposes an OpenAI-compatible
 * API, so a single ``@ai-sdk/openai`` client with a baseURL override
 * covers every model on the platform.
 *
 * This is a deliberate simplification compared to OpenCode's full
 * provider abstraction (plugins, transform chains, SDK discovery, per-
 * provider auth flows). For the gateway's planner we only need: given
 * a model string, give me a model handle the AI SDK can stream.
 */

const SUPPORTED_PROVIDERS = ["openrouter"] as const
export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number]

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"

export function parseModelId(s: string): { providerId: ProviderId; modelId: string } {
  const slash = s.indexOf("/")
  if (slash === -1) {
    throw new Error(
      `provider: model id must be "provider/model" (got "${s}"). ` +
        `Example: "openrouter/openai/gpt-4o-mini".`,
    )
  }
  const providerId = s.slice(0, slash) as ProviderId
  const modelId = s.slice(slash + 1)
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerId)) {
    throw new Error(
      `provider: unsupported provider "${providerId}" ` +
        `(supported: ${SUPPORTED_PROVIDERS.join(", ")})`,
    )
  }
  return { providerId, modelId }
}

export interface Interface {
  readonly model: (id: string) => Effect.Effect<LanguageModel, Error>
}

export class Service extends Context.Service<Service, Interface>()("@bindu/Provider") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).get()
    const providers: z.infer<typeof Config>["provider"] = config.provider

    function build(providerId: ProviderId, modelId: string): LanguageModel {
      const providerCfg = providers[providerId]
      // OpenRouter's API is OpenAI-compatible — one @ai-sdk/openai
      // client pointed at OpenRouter's baseURL handles every model.
      const p = createOpenAI({
        apiKey: providerCfg?.apiKey,
        baseURL: providerCfg?.baseURL ?? OPENROUTER_DEFAULT_BASE_URL,
      })
      return p(modelId)
    }

    return Service.of({
      model: (id) =>
        Effect.try({
          try: () => {
            const { providerId, modelId } = parseModelId(id)
            return build(providerId, modelId)
          },
          catch: (e) => (e instanceof Error ? e : new Error(`provider.model: ${String(e)}`)),
        }),
    })
  }),
)
