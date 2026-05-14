import type { EventKind, EventState, TrustLevel } from "~/types";

export function shortDid(did: string): string {
	if (did.length <= 28) return did;
	const parts = did.split(":");
	const last = parts[parts.length - 1] ?? "";
	return parts.slice(0, -1).join(":") + ":" + last.slice(0, 6) + "…";
}

export const trustMeta: Record<
	TrustLevel,
	{ label: string; color: string; bg: string; border: string }
> = {
	self: {
		label: "you",
		color: "text-slate-600",
		bg: "bg-slate-100",
		border: "border-slate-200",
	},
	trusted: {
		label: "trusted",
		color: "text-emerald-700",
		bg: "bg-emerald-50",
		border: "border-emerald-200",
	},
	known: {
		label: "known",
		color: "text-blue-800",
		bg: "bg-blue-50",
		border: "border-blue-200",
	},
	new: {
		label: "first-contact",
		color: "text-yellow-800",
		bg: "bg-yellow-50",
		border: "border-yellow-300",
	},
	untrusted: {
		label: "untrusted",
		color: "text-rose-700",
		bg: "bg-rose-50",
		border: "border-rose-200",
	},
};

export const stateMeta: Record<
	EventState,
	{ color: string; bg: string; border: string }
> = {
	pending: {
		color: "text-slate-600",
		bg: "bg-slate-100",
		border: "border-slate-200",
	},
	working: {
		color: "text-blue-800",
		bg: "bg-blue-50",
		border: "border-blue-200",
	},
	"input-required": {
		color: "text-yellow-800",
		bg: "bg-yellow-50",
		border: "border-yellow-300",
	},
	"payment-required": {
		color: "text-blue-900",
		bg: "bg-blue-100",
		border: "border-blue-300",
	},
	"auth-required": {
		color: "text-yellow-900",
		bg: "bg-yellow-100",
		border: "border-yellow-400",
	},
	completed: {
		color: "text-emerald-700",
		bg: "bg-emerald-50",
		border: "border-emerald-200",
	},
	failed: {
		color: "text-rose-700",
		bg: "bg-rose-50",
		border: "border-rose-200",
	},
};

export const kindGlyph: Record<EventKind, string> = {
	"first-contact": "✦",
	negotiation: "⇄",
	payment: "₿",
	"state-change": "→",
	artifact: "✓",
	"human-action": "●",
	"plan-step": "▶",
	heartbeat: "·",
};
