import type { MessageWithParts } from "./message"

/**
 * Token accounting + overflow detection for session history.
 *
 * Phase 1 keeps the accounting approximate — we use the `tokens` field
 * already tracked on assistant messages (populated from the LLM's finish
 * event). User messages and tool inputs/outputs are estimated by a cheap
 * char-count heuristic.
 *
 * OpenCode's `session/overflow.ts` uses the provider's declared `context`
 * and `input` limits. We do the same but read those from config instead of
 * from a Provider.Model (our provider service is thinner).
 */

export interface OverflowThreshold {
  /** Model-level context window in tokens. */
  contextWindow: number
  /** Reserve this many tokens for the next response. */
  reserveForOutput: number
  /** Compact when usage exceeds this fraction of (contextWindow - reserve). */
  triggerFraction: number
}

export const DEFAULT_THRESHOLD: OverflowThreshold = {
  contextWindow: 200_000, // Claude Opus 4.x; conservative for other models
  reserveForOutput: 16_000,
  triggerFraction: 0.8,
}

/** Very rough token estimate — 1 token ≈ 4 chars for English/code. */
export function approxTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function estimatePartTokens(parts: MessageWithParts["parts"]): number {
  let total = 0
  for (const p of parts) {
    if (p.type === "text") total += approxTokens(p.text)
    if (p.type === "tool") {
      if (p.state.status === "completed") {
        total += approxTokens(p.state.output)
        total += approxTokens(JSON.stringify(p.state.input ?? ""))
      } else if (p.state.status === "error") {
        total += approxTokens(p.state.error)
      } else if ("input" in p.state) {
        total += approxTokens(JSON.stringify(p.state.input ?? ""))
      }
    }
    if (p.type === "file") total += 512 // image-ish default; file attachments rare in Phase 1
  }
  return total
}

export function estimateHistoryTokens(history: MessageWithParts[]): number {
  let total = 0
  for (const m of history) {
    if (m.info.role === "assistant" && m.info.tokens) {
      // Prefer the authoritative count when available.
      total += m.info.tokens.total || m.info.tokens.input + m.info.tokens.output
      continue
    }
    total += estimatePartTokens(m.parts)
  }
  return total
}

export function isOverflow(tokens: number, threshold: OverflowThreshold = DEFAULT_THRESHOLD): boolean {
  const usable = Math.max(0, threshold.contextWindow - threshold.reserveForOutput)
  return tokens >= usable * threshold.triggerFraction
}
