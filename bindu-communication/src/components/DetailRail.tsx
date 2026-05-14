import clsx from "clsx";
import { events } from "~/data/mock";
import { useUI } from "~/state";
import { stateMeta, trustMeta } from "~/lib/format";
import type { DetailTab } from "~/types";

const TABS: { k: DetailTab; label: string; hint: string }[] = [
	{ k: "glance", label: "Glance", hint: "operator" },
	{ k: "verify", label: "Verify", hint: "auditor" },
	{ k: "inspect", label: "Inspect", hint: "developer" },
];

export function DetailRail() {
	const selectedEventId = useUI((s) => s.selectedEventId);
	const detailTab = useUI((s) => s.detailTab);
	const setDetailTab = useUI((s) => s.setDetailTab);
	const event = events.find((e) => e.id === selectedEventId) ?? null;

	if (!event) {
		return (
			<aside className="flex w-[400px] shrink-0 flex-col border-l border-[--color-border-soft] bg-[--color-rail]">
				<div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-fg-dim">
					Select an event to inspect it
				</div>
			</aside>
		);
	}

	const tb = trustMeta[event.counterparty.trust];
	const sb = event.state ? stateMeta[event.state] : null;

	return (
		<aside className="flex w-[400px] shrink-0 flex-col border-l border-[--color-border-soft] bg-[--color-rail]">
			{/* Summary header */}
			<div className="border-b border-[--color-border-soft] px-5 py-4">
				<div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-fg-dim">
					<span>{event.kind}</span>
					<span>·</span>
					<span>{event.relTs}</span>
				</div>
				<div className="mt-1 text-[13px] font-medium text-fg">
					{event.summary}
				</div>
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<span
						className={clsx(
							"rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
							tb.bg,
							tb.color,
							tb.border,
						)}
					>
						{tb.label}
					</span>
					{sb && event.state && (
						<span
							className={clsx(
								"rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
								sb.bg,
								sb.color,
								sb.border,
							)}
						>
							{event.state}
						</span>
					)}
					{event.signed && (
						<span className="text-[10px] text-emerald-600">✓ signed</span>
					)}
				</div>
			</div>

			{/* Tabs */}
			<div className="flex border-b border-[--color-border-soft]">
				{TABS.map((t) => (
					<button
						key={t.k}
						type="button"
						onClick={() => setDetailTab(t.k)}
						className={clsx(
							"flex flex-1 flex-col items-center border-b-2 px-4 py-2 transition",
							detailTab === t.k
								? "border-[--color-cobalt] text-fg"
								: "border-transparent text-fg-dim hover:text-fg-muted",
						)}
					>
						<span className="text-[12px]">{t.label}</span>
						<span className="text-[9px] text-fg-dim">{t.hint}</span>
					</button>
				))}
			</div>

			{/* Body */}
			<div className="scrollbar flex-1 overflow-y-auto px-5 py-4">
				{detailTab === "glance" && <GlanceBody />}
				{detailTab === "verify" && <VerifyBody />}
				{detailTab === "inspect" && <InspectBody />}
			</div>
		</aside>
	);
}

function GlanceBody() {
	const selectedEventId = useUI((s) => s.selectedEventId);
	const event = events.find((e) => e.id === selectedEventId);
	if (!event) return null;

	return (
		<div className="space-y-4">
			<Section label="Counterparty">
				<div className="text-[13px] text-fg">{event.counterparty.name}</div>
				<div className="break-all text-[11px] text-fg-dim">
					{event.counterparty.did}
				</div>
			</Section>

			{event.recipe && (
				<Section label="Recipe">
					<div className="text-[13px] text-[--color-cobalt-strong]">{event.recipe}</div>
				</Section>
			)}

			{event.planStep && (
				<Section label="Planner rationale">
					<div className="text-[12px] text-fg-muted">{event.planStep}</div>
				</Section>
			)}

			{event.action && (
				<div className="rounded-md border border-yellow-300 bg-yellow-50 p-3">
					<div className="text-[10px] uppercase tracking-[0.15em] text-yellow-800">
						Action required
					</div>
					<div className="mt-2 flex gap-2">
						<button
							type="button"
							className="rounded-md bg-[--color-sunflower] px-3 py-1.5 text-[12px] font-medium text-yellow-900 transition hover:bg-[--color-sunflower-strong]"
						>
							{event.action.label}
						</button>
						<button
							type="button"
							className="rounded-md border border-[--color-border] bg-white px-3 py-1.5 text-[12px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
						>
							Decline
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function VerifyBody() {
	const selectedEventId = useUI((s) => s.selectedEventId);
	const event = events.find((e) => e.id === selectedEventId);
	if (!event) return null;

	return (
		<div className="space-y-1 text-[12px]">
			<VerifyRow
				label="Signature"
				value={event.verify.signature ? "✓ valid (Ed25519)" : "✗ invalid"}
				ok={event.verify.signature}
			/>
			<VerifyRow
				label="DID document"
				value={
					event.verify.didMatch ? "✓ key matches resolved doc" : "✗ key mismatch"
				}
				ok={event.verify.didMatch}
			/>
			<VerifyRow label="Nonce" value={event.verify.nonce} ok mono />
			<VerifyRow label="Timestamp" value={event.ts} ok mono />

			<div className="mt-4 rounded-md border border-[--color-border-soft] bg-slate-50 p-3">
				<div className="text-[10px] uppercase tracking-[0.15em] text-fg-dim">
					Resolved DID document
				</div>
				<pre className="mt-2 overflow-x-auto text-[10px] text-slate-700">{`{
  "id": "${event.counterparty.did}",
  "verificationMethod": [{
    "id": "${event.counterparty.did}#key-1",
    "type": "Ed25519VerificationKey2020",
    "publicKeyMultibase": "z6Mk…${event.verify.nonce.slice(0, 4)}"
  }]
}`}</pre>
			</div>
		</div>
	);
}

function InspectBody() {
	const selectedEventId = useUI((s) => s.selectedEventId);
	const event = events.find((e) => e.id === selectedEventId);
	if (!event) return null;

	return (
		<div className="space-y-4">
			<Section label="Raw JSON-RPC">
				<pre className="mt-1 overflow-x-auto rounded-md border border-[--color-border-soft] bg-slate-900 p-3 text-[10px] text-slate-100">
					{event.payload ?? "(no payload captured)"}
				</pre>
			</Section>
			<Section label="Timing">
				<div className="text-[11px] text-fg-muted">
					received {event.ts} · processed in 41ms
				</div>
			</Section>
			<Section label="Request ID">
				<div className="text-[11px] text-fg-muted">
					req_{event.id}_{event.verify.nonce}
				</div>
			</Section>
		</div>
	);
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="text-[10px] uppercase tracking-[0.15em] text-fg-dim">
				{label}
			</div>
			<div className="mt-1">{children}</div>
		</div>
	);
}

function VerifyRow({
	label,
	value,
	ok,
	mono,
}: {
	label: string;
	value: string;
	ok: boolean;
	mono?: boolean;
}) {
	return (
		<div className="flex items-start justify-between gap-3 border-b border-[--color-border-soft] py-2">
			<span className="text-[10px] uppercase tracking-[0.15em] text-fg-dim">
				{label}
			</span>
			<span
				className={clsx(
					"text-right text-[11px]",
					mono && "font-mono",
					ok ? "text-emerald-700" : "text-rose-700",
				)}
			>
				{value}
			</span>
		</div>
	);
}
