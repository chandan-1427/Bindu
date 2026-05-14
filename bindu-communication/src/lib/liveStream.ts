import type { EventKind, EventState, StreamEvent } from "~/types";

interface RawWebhook {
	id: string;
	agentId: string;
	receivedAt: string;
	payload: {
		event_id?: string;
		sequence?: number;
		timestamp?: string;
		kind?: "status-update" | "artifact-update" | string;
		task_id?: string;
		context_id?: string;
		status?: { state?: string };
		artifact?: unknown;
		final?: boolean;
	};
}

// Track per-agent context_ids so the first sighting of a context renders as
// first-contact instead of just another state-change.
const seenContexts = new Map<string, Set<string>>();

function markContext(agentId: string, contextId: string | undefined): boolean {
	if (!contextId) return false;
	let set = seenContexts.get(agentId);
	if (!set) {
		set = new Set();
		seenContexts.set(agentId, set);
	}
	if (set.has(contextId)) return false;
	set.add(contextId);
	return true;
}

const ATTENTION_STATES = new Set<EventState>([
	"input-required",
	"payment-required",
	"auth-required",
]);

const ACTION_FOR_STATE: Record<string, StreamEvent["action"]> = {
	"input-required": { kind: "input", label: "Provide Input" },
	"payment-required": { kind: "pay", label: "Pay" },
	"auth-required": { kind: "approve", label: "Authorize" },
};

const KNOWN_STATES = new Set<EventState>([
	"submitted",
	"pending",
	"working",
	"input-required",
	"payment-required",
	"auth-required",
	"completed",
	"failed",
]);

function normalizeState(raw: string | undefined, isArtifact: boolean): EventState | undefined {
	if (isArtifact) return "completed";
	if (!raw) return undefined;
	return KNOWN_STATES.has(raw as EventState) ? (raw as EventState) : undefined;
}

export function mapWebhookToEvent(raw: RawWebhook): StreamEvent {
	const p = raw.payload;
	const isArtifact = p.kind === "artifact-update";
	const state = normalizeState(p.status?.state, isArtifact);
	const firstContact = !isArtifact && markContext(raw.agentId, p.context_id);

	let kind: EventKind;
	if (isArtifact) kind = "artifact";
	else if (firstContact) kind = "first-contact";
	else kind = "state-change";

	const taskShort = p.task_id?.slice(0, 8) ?? "task";
	const summary = isArtifact
		? "Artifact delivered"
		: firstContact
			? `New task · ${taskShort}`
			: state === "completed"
				? `Completed${p.final ? " · final" : ""}`
				: state === "failed"
					? "Failed"
					: state
						? `state → ${state}${p.final ? " · final" : ""}`
						: "(unknown state)";

	return {
		id: raw.id,
		agentId: raw.agentId,
		ts: (p.timestamp ?? raw.receivedAt).slice(11, 19),
		relTs: "live",
		counterparty: {
			name: taskShort,
			did: `did:bindu:task:${p.task_id ?? "?"}`,
			trust: firstContact ? "new" : "known",
		},
		kind,
		state,
		summary,
		needsAttention: state ? ATTENTION_STATES.has(state) || undefined : undefined,
		action: state ? ACTION_FOR_STATE[state] : undefined,
		signed: true,
		verify: {
			signature: true,
			didMatch: true,
			nonce: (p.event_id ?? "").slice(0, 8) || "—",
		},
		payload: JSON.stringify(p, null, 2),
	};
}
