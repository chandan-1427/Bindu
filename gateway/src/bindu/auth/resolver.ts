import { z } from "zod"

/**
 * Per-peer auth configuration — describes how to authenticate against a
 * downstream Bindu agent.
 *
 * Phase 1 supports: `none` (for dev agents with auth disabled),
 * `bearer` (static JWT inline in the plan request), and `bearer_env`
 * (read from process.env by name, useful when External passes `$VAR`).
 *
 * Phase 3 adds: `oauth2_client_credentials` (Hydra), `mtls`.
 */

export const PeerAuth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({ type: z.literal("bearer_env"), envVar: z.string() }),
])
export type PeerAuth = z.infer<typeof PeerAuth>

/**
 * Build HTTP headers for a given auth descriptor. Returns headers that
 * should be merged into every request to the peer.
 *
 * Never logs the resolved token — callers printing diagnostics should
 * redact themselves.
 */
export function authHeaders(auth: PeerAuth | undefined): Record<string, string> {
  if (!auth || auth.type === "none") return {}
  if (auth.type === "bearer") return { Authorization: `Bearer ${auth.token}` }
  if (auth.type === "bearer_env") {
    const v = process.env[auth.envVar]
    if (!v) {
      throw new Error(
        `auth: env var "${auth.envVar}" is not set (peer requires bearer auth from env)`,
      )
    }
    return { Authorization: `Bearer ${v}` }
  }
  return {}
}
