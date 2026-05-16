import { Context, Effect, Layer } from "effect"
import { AssistantMessageInfo, UserMessageInfo, type MessageInfo, type MessageWithParts, type Part } from "./message"
import { MessageID, SessionID, newMessageID, newSessionID } from "./schema"

/**
 * Session service — in-memory (Path A, stateless gateway).
 *
 * The gateway no longer owns durability. Each /plan request hands us
 * the prior history (from the client's record); we stash it for the
 * lifetime of the call, append new turns as the planner runs, and
 * forget it when the process restarts. Compaction summaries that the
 * planner produces get shipped to the client via SSE (see
 * `session/compaction.ts` + `api/plan-route.ts`) so the client can
 * persist and replay them on the next call.
 *
 * Memory model: one Map<SessionID, InMemorySession>. Sessions accumulate
 * over the process lifetime — for a single-operator deployment this is
 * bounded by request rate × turn count and is well under any
 * meaningful memory pressure. If that changes (multi-tenant SaaS,
 * etc.) add a TTL sweep here.
 */

// Local SessionRow shape — used to be in ../db, kept here at the same
// shape callers expect so the planner/api don't need to change.
export interface SessionRow {
  id: string
  external_session_id: string | null
  agent_catalog: unknown[]
  created_at: string
  last_active_at: string
}

interface InMemorySession {
  id: SessionID
  externalSessionID: string | null
  agentCatalog: unknown[]
  history: MessageWithParts[]
  compactionSummary: string | null
  createdAt: string
  lastActiveAt: string
}

const store = new Map<SessionID, InMemorySession>()

function toRow(s: InMemorySession): SessionRow {
  return {
    id: s.id,
    external_session_id: s.externalSessionID,
    agent_catalog: s.agentCatalog,
    created_at: s.createdAt,
    last_active_at: s.lastActiveAt,
  }
}

export interface CreateInput {
  externalSessionID?: string
  userPrefs?: Record<string, unknown>
  agentCatalog?: unknown[]
}

export interface AppendUserInput {
  sessionID: SessionID
  parts: Part[]
}

export interface AppendAssistantInput {
  sessionID: SessionID
  info: AssistantMessageInfo
  parts: Part[]
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<SessionRow, Error>
  readonly get: (key: { id?: string; externalID?: string }) => Effect.Effect<SessionRow | undefined, Error>
  readonly touch: (id: SessionID) => Effect.Effect<void, Error>
  readonly updateAgentCatalog: (id: SessionID, catalog: unknown[]) => Effect.Effect<void, Error>
  readonly history: (id: SessionID) => Effect.Effect<MessageWithParts[], Error>
  readonly appendUser: (input: AppendUserInput) => Effect.Effect<MessageWithParts, Error>
  readonly appendAssistant: (input: AppendAssistantInput) => Effect.Effect<MessageWithParts, Error>
  readonly replaceAssistant: (input: AppendAssistantInput) => Effect.Effect<MessageWithParts, Error>
  // Compaction-summary slots — used to live on the DB row, now live
  // on the in-memory session. The compaction layer reads via
  // getSummary(), writes via setSummary(), and prunes the head of
  // history via markCompacted(). All scoped to the session's lifetime
  // in this process.
  readonly getSummary: (id: SessionID) => Effect.Effect<string | null, Error>
  readonly setSummary: (id: SessionID, summary: string) => Effect.Effect<void, Error>
  readonly markCompacted: (
    id: SessionID,
    messageIDs: ReadonlyArray<MessageID>,
  ) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@bindu/Session") {}

function parseInfo(raw: unknown, msgID: string): MessageInfo {
  const obj = raw as Record<string, unknown>
  if (obj.role === "user") return UserMessageInfo.parse(obj)
  if (obj.role === "assistant") return AssistantMessageInfo.parse(obj)
  throw new Error(`session: unknown role on message ${msgID}: ${String(obj.role)}`)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const create: Interface["create"] = ({ externalSessionID, agentCatalog }) =>
      Effect.sync(() => {
        const id = newSessionID()
        const now = new Date().toISOString()
        const sess: InMemorySession = {
          id,
          externalSessionID: externalSessionID ?? null,
          agentCatalog: agentCatalog ?? [],
          history: [],
          compactionSummary: null,
          createdAt: now,
          lastActiveAt: now,
        }
        store.set(id, sess)
        return toRow(sess)
      })

    const get: Interface["get"] = (key) =>
      Effect.sync(() => {
        if (key.id) {
          const s = store.get(key.id as SessionID)
          return s ? toRow(s) : undefined
        }
        if (key.externalID) {
          for (const s of store.values()) {
            if (s.externalSessionID === key.externalID) return toRow(s)
          }
        }
        return undefined
      })

    const touch: Interface["touch"] = (id) =>
      Effect.sync(() => {
        const s = store.get(id)
        if (s) s.lastActiveAt = new Date().toISOString()
      })

    const updateAgentCatalog: Interface["updateAgentCatalog"] = (id, catalog) =>
      Effect.sync(() => {
        const s = store.get(id)
        if (s) {
          s.agentCatalog = catalog
          s.lastActiveAt = new Date().toISOString()
        }
      })

    const history: Interface["history"] = (sessionID) =>
      Effect.sync(() => {
        const s = store.get(sessionID)
        if (!s) return []
        // Mirrors the old DB-backed behavior: prepend the compaction
        // summary as a synthetic user turn so the planner sees prior
        // context that has been folded into the summary. "user" role
        // (not "system") preserves the planner's own system block.
        if (!s.compactionSummary) return s.history
        const synthetic: MessageWithParts = {
          info: {
            id: newMessageID(),
            sessionID,
            role: "user",
            time: { created: Date.now() },
          },
          parts: [
            {
              id: newMessageID() as unknown as import("./schema").PartID,
              type: "text",
              text: `[Prior session context, compacted]\n\n${s.compactionSummary}`,
              synthetic: true,
              time: { start: Date.now() },
            },
          ],
        }
        return [synthetic, ...s.history]
      })

    const appendUser: Interface["appendUser"] = ({ sessionID, parts }) =>
      Effect.sync(() => {
        const s = store.get(sessionID)
        if (!s) throw new Error(`session: appendUser on unknown ${sessionID}`)
        const info: UserMessageInfo = {
          id: newMessageID(),
          sessionID,
          role: "user",
          time: { created: Date.now() },
        }
        const msg: MessageWithParts = { info, parts }
        s.history.push(msg)
        s.lastActiveAt = new Date().toISOString()
        return msg
      })

    const appendAssistant: Interface["appendAssistant"] = ({ sessionID, info, parts }) =>
      Effect.sync(() => {
        const s = store.get(sessionID)
        if (!s) throw new Error(`session: appendAssistant on unknown ${sessionID}`)
        const msg: MessageWithParts = { info, parts }
        s.history.push(msg)
        s.lastActiveAt = new Date().toISOString()
        return msg
      })

    // Stateless mode keeps replaceAssistant as an append — the planner
    // currently emits one row per step, and the in-memory store has no
    // notion of "the previous assistant message for this messageID" to
    // overwrite. If that becomes important later we can index by
    // info.id and splice.
    const replaceAssistant: Interface["replaceAssistant"] = appendAssistant

    const getSummary: Interface["getSummary"] = (id) =>
      Effect.sync(() => store.get(id)?.compactionSummary ?? null)

    const setSummary: Interface["setSummary"] = (id, summary) =>
      Effect.sync(() => {
        const s = store.get(id)
        if (s) {
          s.compactionSummary = summary
          s.lastActiveAt = new Date().toISOString()
        }
      })

    const markCompacted: Interface["markCompacted"] = (id, messageIDs) =>
      Effect.sync(() => {
        const s = store.get(id)
        if (!s) return
        // For in-memory: actually drop the compacted rows instead of
        // marking them with a flag. The DB needed a flag because rows
        // had to persist for audit; in-memory has no such constraint
        // and dropping saves bytes during long sessions.
        const idSet = new Set(messageIDs.map(String))
        s.history = s.history.filter((m) => !idSet.has(String(m.info.id)))
        s.lastActiveAt = new Date().toISOString()
      })

    return Service.of({
      create,
      get,
      touch,
      updateAgentCatalog,
      history,
      appendUser,
      appendAssistant,
      replaceAssistant,
      getSummary,
      setSummary,
      markCompacted,
    })
  }),
)

export { SessionID, newSessionID, MessageID, newMessageID } from "./schema"
export type { MessageWithParts } from "./message"
export * as Message from "./message"
export * as Compaction from "./compaction"
export * as Overflow from "./overflow"
export * as Summary from "./summary"
