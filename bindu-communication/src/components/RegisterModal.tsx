import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import { XIcon, KeyIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useUI, type TrustPolicy } from "~/state";
import type { AgentRole } from "~/types";
import { Modal } from "./Modal";
import { slugify } from "~/lib/format";

const ROLES: { value: AgentRole; label: string; desc: string }[] = [
	{ value: "agent", label: "Agent", desc: "Standard A2A endpoint that responds to other agents." },
	{ value: "gateway", label: "Gateway", desc: "Planner that orchestrates downstream agents." },
];

const POLICIES: { value: TrustPolicy; label: string; desc: string }[] = [
	{
		value: "fully-supervised",
		label: "Fully supervised",
		desc: "Every action waits for human approval. Slowest, safest. Good for debugging.",
	},
	{
		value: "policy-driven",
		label: "Policy-driven",
		desc: "Trust-level + payment threshold decide when to interrupt you. Production default.",
	},
	{
		value: "fully-autonomous",
		label: "Fully autonomous",
		desc: "Agent runs without human checkpoints. Reserved for trusted, low-risk workloads.",
	},
];

function generateDid(name: string, role: AgentRole): string {
	const slug = slugify(name, "new-agent");
	const rand = Math.random().toString(16).slice(2, 10);
	const tail = `${rand.slice(0, 4)}-${rand.slice(4, 8)}`;
	return `did:bindu:raahul:${role === "gateway" ? "gateway" : slug}:${tail}`;
}

export function RegisterModal() {
	const showRegister = useUI((s) => s.showRegister);
	const closeRegister = useUI((s) => s.closeRegister);
	const registerAgent = useUI((s) => s.registerAgent);
	const navigate = useNavigate();

	const [name, setName] = useState("");
	const [role, setRole] = useState<AgentRole>("agent");
	const [did, setDid] = useState(() => generateDid("", "agent"));
	const [trustPolicy, setTrustPolicy] = useState<TrustPolicy>("policy-driven");

	useEffect(() => {
		if (showRegister) {
			setName("");
			setRole("agent");
			setDid(generateDid("", "agent"));
			setTrustPolicy("policy-driven");
		}
	}, [showRegister]);

	useEffect(() => {
		setDid(generateDid(name, role));
	}, [name, role]);

	const canSubmit = name.trim().length > 0;

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		const created = registerAgent({ name: name.trim(), role, did, trustPolicy });
		navigate(`/agents/${created.id}`);
	}

	return (
		<Modal open={showRegister} onClose={closeRegister}>
			<form
				onSubmit={handleSubmit}
				className="w-[480px] max-w-[92vw] rounded-lg border border-[--color-border] bg-white shadow-2xl"
			>
				{/* Header */}
				<div className="flex items-center gap-2.5 border-b border-[--color-border-soft] px-5 py-3">
					<img
						src="/bindu.png"
						alt=""
						className="h-7 w-7 shrink-0 select-none"
						draggable={false}
					/>
					<div className="flex-1">
						<h2 className="text-[14px] font-medium text-fg">Register agent</h2>
						<div className="text-[10px] text-fg-dim">
							Every agent is a bindu — a sunflower with a DID of its own.
						</div>
					</div>
					<button
						type="button"
						onClick={closeRegister}
						className="rounded p-1 text-fg-dim transition hover:bg-slate-100 hover:text-fg"
					>
						<XIcon size={14} weight="bold" />
					</button>
				</div>

				{/* Body */}
				<div className="space-y-5 px-5 py-5">
					{/* Name */}
					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							Agent name
						</label>
						<input
							autoFocus
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. translator-agent"
							className="mt-1.5 w-full rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] text-fg placeholder-fg-faint outline-none transition focus:border-[--color-cobalt] focus:ring-2 focus:ring-[--color-cobalt-soft]"
						/>
					</div>

					{/* Role */}
					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							Role
						</label>
						<div className="mt-1.5 grid grid-cols-2 gap-2">
							{ROLES.map((r) => (
								<button
									key={r.value}
									type="button"
									onClick={() => setRole(r.value)}
									className={clsx(
										"rounded-md border px-3 py-2 text-left transition",
										role === r.value
											? "border-[--color-cobalt] bg-[--color-cobalt-soft]"
											: "border-[--color-border] bg-white hover:border-[--color-cobalt]",
									)}
								>
									<div className="text-[12px] font-medium text-fg">{r.label}</div>
									<div className="mt-0.5 text-[10px] leading-snug text-fg-dim">
										{r.desc}
									</div>
								</button>
							))}
						</div>
					</div>

					{/* DID */}
					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							Decentralized identifier
						</label>
						<div className="mt-1.5 flex items-center gap-2 rounded-md border border-[--color-border] bg-slate-50 px-3 py-2">
							<KeyIcon size={12} weight="duotone" className="shrink-0 text-[--color-cobalt]" />
							<code className="flex-1 truncate text-[11px] text-fg">{did}</code>
							<button
								type="button"
								onClick={() => setDid(generateDid(name, role))}
								title="Regenerate"
								className="rounded p-1 text-fg-dim transition hover:bg-slate-200 hover:text-[--color-cobalt]"
							>
								<ArrowsClockwiseIcon size={12} weight="bold" />
							</button>
						</div>
						<div className="mt-1 text-[10px] text-fg-dim">
							Ed25519 keypair generated locally; private key stays on this device.
						</div>
					</div>

					{/* Trust policy */}
					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							Trust policy
						</label>
						<div className="mt-1.5 space-y-1.5">
							{POLICIES.map((p) => (
								<button
									key={p.value}
									type="button"
									onClick={() => setTrustPolicy(p.value)}
									className={clsx(
										"flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition",
										trustPolicy === p.value
											? "border-[--color-cobalt] bg-[--color-cobalt-soft]"
											: "border-[--color-border] bg-white hover:border-[--color-cobalt]",
									)}
								>
									<span
										className={clsx(
											"mt-1 inline-block h-2 w-2 shrink-0 rounded-full",
											trustPolicy === p.value
												? "bg-[--color-cobalt]"
												: "bg-slate-300",
										)}
									/>
									<div>
										<div className="text-[12px] font-medium text-fg">{p.label}</div>
										<div className="mt-0.5 text-[10px] leading-snug text-fg-dim">
											{p.desc}
										</div>
									</div>
								</button>
							))}
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-t border-[--color-border-soft] bg-slate-50 px-5 py-3">
					<button
						type="button"
						onClick={closeRegister}
						className="rounded-md border border-[--color-border] bg-white px-3 py-1.5 text-[12px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!canSubmit}
						className={clsx(
							"rounded-md px-3 py-1.5 text-[12px] font-medium shadow-sm transition",
							canSubmit
								? "bg-[--color-cobalt] text-white hover:bg-[--color-cobalt-strong]"
								: "bg-slate-200 text-slate-400",
						)}
					>
						Register agent
					</button>
				</div>
			</form>
		</Modal>
	);
}
