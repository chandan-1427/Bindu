export type TrustLevel = "self" | "trusted" | "known" | "new" | "untrusted";

export type EventState =
	| "submitted"
	| "pending"
	| "working"
	| "input-required"
	| "payment-required"
	| "auth-required"
	| "completed"
	| "failed";

export type EventKind =
	| "first-contact"
	| "negotiation"
	| "payment"
	| "state-change"
	| "artifact"
	| "human-action"
	| "plan-step"
	| "heartbeat";

export type AgentRole = "agent" | "gateway";

export interface Agent {
	id: string;
	name: string;
	did: string;
	unread: number;
	needsAttention: number;
	role: AgentRole;
}

export interface Scope {
	id: string;
	name: string;
	count: number;
}

export interface Counterparty {
	name: string;
	did: string;
	trust: TrustLevel;
}

export interface StreamEvent {
	id: string;
	agentId: string;
	parentId?: string;
	ts: string;
	relTs: string;
	counterparty: Counterparty;
	kind: EventKind;
	state?: EventState;
	summary: string;
	needsAttention?: boolean;
	action?: { kind: "approve" | "pay" | "input"; label: string };
	signed: boolean;
	verify: { signature: boolean; didMatch: boolean; nonce: string };
	payload?: string;
	recipe?: string;
	planStep?: string;
}

export type DetailTab = "glance" | "verify" | "inspect";
