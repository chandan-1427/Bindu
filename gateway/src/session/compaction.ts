import { Context, Effect, Layer } from "effect"
import type { LanguageModel } from "ai"
import { Service as DBService } from "../db"
import { Service as ProviderService } from "../provider"
import { Service as SessionService } from "./index"
import { DEFAULT_THRESHOLD, estimateHistoryTokens, isOverflow, type OverflowThreshold } from "./overflow"
import { summarize } from "./summary"
import type { SessionID } from "./schema"
import type { MessageWithParts } from "./message"

/**
 * Session compaction service.
 *
 * Strategy (Phase 1 — simple, effective, replaceable later):
 *   1. Estimate total tokens in history.
 *   2. If over the trigger fraction of the usable context window:
 *      a. Split history at `keepTail` turns from the end.
 *      b. Summarize the head into one paragraph via a cheap model call.
 *      c. Store the summary on the session row.
 *      d. Mark all compacted messages with `compacted=true` so history()
 *         calls skip them.
 *   3. On next `prompt()`, the session loader prepends the summary as a
 *      synthetic system message, then loads only non-compacted turns.
 *
 * Rationale for summary-based rather than truncation: for multi-agent
 * plans, the load-bearing facts are scattered across tool results. Simple
 * truncation loses them. A paragraph is much cheaper than raw history and
 * preserves the planner's ability to reference past calls.
 */

export interface CompactInput {
  sessionID: SessionID
  model: string // "provider/modelId" — the summarizer model (usually same as planner)
  abortSignal?: AbortSignal
  /** Minimum recent turns to preserve verbatim. */
  keepTail?: number
  threshold?: OverflowThreshold
}

export interface CompactOutcome {
  compacted: boolean
  tokensBefore: number
  tokensAfter?: number
  summary?: string
  messagesCompactedCount?: number
}

export interface Interface {
  readonly compactIfNeeded: (input: CompactInput) => Effect.Effect<CompactOutcome, Error>
  readonly forceCompact: (input: CompactInput) => Effect.Effect<CompactOutcome, Error>
}

export class Service extends Context.Service<Service, Interface>()("@bindu/SessionCompaction") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* DBService
    const sessions = yield* SessionService
    const provider = yield* ProviderService

    function splitHead(
      history: MessageWithParts[],
      keepTail: number,
    ): { head: MessageWithParts[]; tail: MessageWithParts[] } {
      if (history.length <= keepTail) return { head: [], tail: history }
      return {
        head: history.slice(0, history.length - keepTail),
        tail: history.slice(history.length - keepTail),
      }
    }

    /** True if the message is the synthetic "prior summary" injected by
     *  session.history() — has no backing row in gateway_messages. */
    function isSynthetic(m: MessageWithParts): boolean {
      return m.parts.some((p) => (p as { synthetic?: boolean }).synthetic === true)
    }

    async function runCompaction(
      history: MessageWithParts[],
      llm: LanguageModel,
      keepTail: number,
      sessionID: SessionID,
      abortSignal?: AbortSignal,
    ): Promise<CompactOutcome> {
      // session.history() prepends a synthetic message carrying the prior
      // compaction_summary (if any). Don't treat it as a real head row —
      // its id is not in gateway_messages, so the "mark compacted" UPDATE
      // would silently no-op, AND summarizing the synthetic as part of
      // `head` would produce a lossy paraphrase-of-paraphrase (the bug
      // this refactor fixes). Instead, pull the summary text out as
      // `priorSummary` and feed it to the summarizer explicitly with
      // facts-preservation instructions.
      const client = db.client()
      const before = estimateHistoryTokens(history)

      const realHistory = history.filter((m) => !isSynthetic(m))
      const { head, tail } = splitHead(realHistory, keepTail)

      // Read prior summary directly from the session row so we don't depend
      // on history()'s synthetic-injection contract (keeps this path
      // correct even if the caller passed history from a different source).
      const { data: sessData, error: sessReadErr } = await client
        .from("gateway_sessions")
        .select("compaction_summary")
        .eq("id", sessionID)
        .maybeSingle()
      if (sessReadErr) {
        throw new Error(`compaction: failed to read session: ${sessReadErr.message}`)
      }
      const priorSummary =
        ((sessData as { compaction_summary?: string | null } | null)?.compaction_summary ?? null) || null

      // If there's nothing new to fold in AND no prior summary, we're done.
      if (head.length === 0 && !priorSummary) {
        return { compacted: false, tokensBefore: before }
      }
      // If there's a prior summary but no new head, the session hasn't
      // grown since the last compaction. No-op — re-summarizing would
      // just be a lossy rewrite of the same content.
      if (head.length === 0) {
        return { compacted: false, tokensBefore: before }
      }

      const summary = await summarize({
        model: llm,
        messagesToCompact: head,
        priorSummary,
        abortSignal,
      })

      // Mark the real head messages as compacted. We filtered synthetic
      // rows out already, so every id here corresponds to a real row.
      const headIds = head
        .map((m) => (m.info as { id?: string }).id)
        .filter((x): x is string => !!x)
      if (headIds.length > 0) {
        const { error } = await client
          .from("gateway_messages")
          .update({ compacted: true })
          .eq("session_id", sessionID)
          .in("id", headIds)
        if (error) {
          throw new Error(`compaction: failed to mark compacted: ${error.message}`)
        }
      }

      // Overwrite compaction_summary with the NEW (superset) summary. Because
      // summarize() was given the priorSummary and instructed to preserve
      // every fact in it, the new value is safe to replace — it already
      // carries forward everything the old one did.
      const { error: sessErr } = await client
        .from("gateway_sessions")
        .update({
          compaction_summary: summary,
          compaction_at: new Date().toISOString(),
        })
        .eq("id", sessionID)
      if (sessErr) {
        throw new Error(`compaction: failed to update session: ${sessErr.message}`)
      }

      const tokensAfter = estimateHistoryTokens(tail) + Math.ceil(summary.length / 4)

      return {
        compacted: true,
        tokensBefore: before,
        tokensAfter,
        summary,
        messagesCompactedCount: head.length,
      }
    }

    const compactIfNeeded: Interface["compactIfNeeded"] = (input) =>
      Effect.gen(function* () {
        const history = yield* sessions.history(input.sessionID)
        const tokens = estimateHistoryTokens(history)
        const threshold = input.threshold ?? DEFAULT_THRESHOLD
        if (!isOverflow(tokens, threshold)) {
          return { compacted: false, tokensBefore: tokens }
        }
        const llm = yield* provider.model(input.model)
        return yield* Effect.tryPromise({
          try: () =>
            runCompaction(
              history,
              llm,
              input.keepTail ?? 4,
              input.sessionID,
              input.abortSignal,
            ),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        })
      })

    const forceCompact: Interface["forceCompact"] = (input) =>
      Effect.gen(function* () {
        const history = yield* sessions.history(input.sessionID)
        const llm = yield* provider.model(input.model)
        return yield* Effect.tryPromise({
          try: () =>
            runCompaction(
              history,
              llm,
              input.keepTail ?? 4,
              input.sessionID,
              input.abortSignal,
            ),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        })
      })

    return Service.of({ compactIfNeeded, forceCompact })
  }),
)
