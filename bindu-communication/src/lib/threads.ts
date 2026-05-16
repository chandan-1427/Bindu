import type { StreamEvent } from "~/types";
import { OUTBOX_AGENT_ID } from "~/lib/constants";
import { shortDid } from "~/lib/format";

export type ThreadOrigin = "operator" | "other";

export interface Thread {
	contextId: string;
	latest: StreamEvent;
	earliest: StreamEvent;
	totalCount: number;
	attentionCount: number;
	latestTs: string;
	earliestTs: string;
	/** Set of distinct agentIds participating in this thread. */
	agentIds: Set<string>;
	/** "operator" = first event was outbound; "other" = first event came in from an agent. */
	origin: ThreadOrigin;
	/** The other party of the conversation, agent-side. For operator-initiated
	 * threads this is the recipient (to_agent_id from the outbound message);
	 * for other-initiated threads it's the first non-outbox agentId. */
	otherPartyAgentId: string | null;
}

/**
 * Group events into Gmail-style threads keyed by their A2A `context_id`.
 *
 * - Events without a context_id (heartbeats, gateway plan-step parents)
 *   are skipped — they don't belong to any conversation.
 * - The `latest` event represents the row preview; sort order is by
 *   `latestTs` DESC so newest threads land on top.
 * - `attentionCount` tells the UI whether to pin a thread above the
 *   regular feed and show the sunflower badge.
 */
export function groupByThread(events: StreamEvent[]): Thread[] {
	const byCtx = new Map<string, Thread>();
	for (const e of events) {
		const ctx = extractContextId(e);
		if (!ctx) continue;
		const existing = byCtx.get(ctx);
		if (!existing) {
			byCtx.set(ctx, {
				contextId: ctx,
				latest: e,
				earliest: e,
				totalCount: 1,
				attentionCount: e.needsAttention ? 1 : 0,
				latestTs: e.ts,
				earliestTs: e.ts,
				agentIds: new Set([e.agentId]),
				origin: "operator",
				otherPartyAgentId: null,
			});
			continue;
		}
		existing.totalCount += 1;
		if (e.needsAttention) existing.attentionCount += 1;
		existing.agentIds.add(e.agentId);
		if (e.ts > existing.latestTs) {
			existing.latest = e;
			existing.latestTs = e.ts;
		}
		if (e.ts < existing.earliestTs) {
			existing.earliest = e;
			existing.earliestTs = e.ts;
		}
	}
	// Second pass: derive origin + otherPartyAgentId from the assembled thread.
	for (const t of byCtx.values()) {
		t.origin = t.earliest.agentId === OUTBOX_AGENT_ID ? "operator" : "other";
		t.otherPartyAgentId = inferOtherParty(t);
	}
	return Array.from(byCtx.values()).sort((a, b) => {
		// Attention threads pinned to top, then by latest timestamp DESC.
		const a1 = a.attentionCount > 0 ? 1 : 0;
		const b1 = b.attentionCount > 0 ? 1 : 0;
		if (a1 !== b1) return b1 - a1;
		return b.latestTs.localeCompare(a.latestTs);
	});
}

function inferOtherParty(t: Thread): string | null {
	// Operator-initiated: pick the recipient declared on the outbound event.
	if (t.origin === "operator" && t.earliest.payload) {
		try {
			const p = JSON.parse(t.earliest.payload) as { to_agent_id?: string };
			if (typeof p.to_agent_id === "string" && p.to_agent_id.length > 0) {
				return p.to_agent_id;
			}
		} catch {
			// no-op
		}
	}
	// Other-initiated: pick the first non-outbox lane.
	for (const id of t.agentIds) {
		if (id !== OUTBOX_AGENT_ID) return id;
	}
	return null;
}

/**
 * "Operational" threads are gateway-only conversations — planner plumbing,
 * not user-facing A2A. We hide them from /inbox and /sent (they're still
 * reachable via /agents/gateway for ops people).
 */
function isOperationalThread(t: Thread): boolean {
	for (const id of t.agentIds) {
		if (id !== "gateway") return false;
	}
	return true;
}

export function threadInFolder(
	t: Thread,
	folder: "inbox" | "sent" | "archive",
	archived: Set<string>,
): boolean {
	if (archived.has(t.contextId)) return folder === "archive";
	if (folder === "archive") return false;
	if (isOperationalThread(t)) return false;
	if (folder === "sent") return t.origin === "operator";
	// inbox: surface everything that didn't start from us, plus operator-
	// initiated threads that have any recipient activity at all (so the
	// reply arrives back into Inbox, Gmail-style).
	return t.origin === "other" || t.agentIds.size > 1;
}

/**
 * Pull a usable thread key off any event shape:
 * - A2A live events carry payload.context_id — that's the real thread id.
 * - Events without one (mock scenarios, gateway plan-step rows whose
 *   payload uses sessionID instead of context_id) fall back to the
 *   counterparty DID so they still group sensibly (one thread per
 *   correspondent / per gateway session).
 */
export function extractContextId(e: StreamEvent): string | null {
	if (e.payload) {
		try {
			const p = JSON.parse(e.payload) as { context_id?: string };
			if (typeof p.context_id === "string" && p.context_id.length > 0) {
				return p.context_id;
			}
		} catch {
			// fall through
		}
	}
	if (e.counterparty?.did) return e.counterparty.did;
	return null;
}

export function shortContextId(ctx: string): string {
	if (ctx.length <= 12) return ctx;
	// DID-style thread keys reuse the DID renderer with a tighter tail.
	if (ctx.startsWith("did:")) return shortDid(ctx, 4);
	// Raw context IDs (UUIDs etc.) get first…last
	return ctx.slice(0, 8) + "…" + ctx.slice(-4);
}

export function eventsInThread(
	all: StreamEvent[],
	contextId: string,
): StreamEvent[] {
	return all
		.filter((e) => extractContextId(e) === contextId)
		.sort((a, b) => a.ts.localeCompare(b.ts));
}
