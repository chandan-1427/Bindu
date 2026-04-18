import { Context, Effect, Layer } from "effect"
import { anthropic, createAnthropic } from "@ai-sdk/anthropic"
import { openai, createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"
import { Service as ConfigService, type Config } from "../config"
import type { z } from "zod"

/**
 * Provider service — Phase 1 minimal.
 *
 * Looks up an AI-SDK LanguageModel handle by "providerId/modelId" string,
 * using the `provider` block in gateway config for API keys and optional
 * baseURL overrides.
 *
 * This is a deliberate simplification compared to OpenCode's full provider
 * abstraction (which handles plugins, transform chains, SDK discovery, usage
 * telemetry, per-provider auth flows). For the gateway's planner we only
 * need: given a model string, give me a model handle the AI SDK can stream.
 */

const SUPPORTED_PROVIDERS = ["anthropic", "openai"] as const
export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number]

export function parseModelId(s: string): { providerId: ProviderId; modelId: string } {
  const slash = s.indexOf("/")
  if (slash === -1) {
    throw new Error(
      `provider: model id must be "provider/model" (got "${s}"). Example: "anthropic/claude-opus-4-7".`,
    )
  }
  const providerId = s.slice(0, slash) as ProviderId
  const modelId = s.slice(slash + 1)
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerId)) {
    throw new Error(
      `provider: unsupported provider "${providerId}" (supported: ${SUPPORTED_PROVIDERS.join(", ")})`,
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
      switch (providerId) {
        case "anthropic": {
          if (providerCfg?.apiKey || providerCfg?.baseURL) {
            const p = createAnthropic({
              apiKey: providerCfg.apiKey,
              baseURL: providerCfg.baseURL,
            })
            return p(modelId)
          }
          return anthropic(modelId)
        }
        case "openai": {
          if (providerCfg?.apiKey || providerCfg?.baseURL) {
            const p = createOpenAI({
              apiKey: providerCfg.apiKey,
              baseURL: providerCfg.baseURL,
            })
            return p(modelId)
          }
          return openai(modelId)
        }
      }
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
