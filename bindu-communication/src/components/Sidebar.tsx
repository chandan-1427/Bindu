import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import {
	PlusIcon,
	GlobeIcon,
	TrayIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	GearIcon,
	ArchiveIcon,
	FileIcon,
} from "@phosphor-icons/react";
import { useUI } from "~/state";
import { shortDid } from "~/lib/format";
import { AddAgentModal } from "./AddAgentModal";
import clsx from "clsx";

interface EcosystemAgent {
	id: string;
	url?: string;
	did?: { id?: string } | null;
	agentCard?: { name?: string } | null;
	source: "webhook" | "manual";
}

function useEcosystem() {
	const [list, setList] = useState<EcosystemAgent[]>([]);
	const [tick, setTick] = useState(0);
	useEffect(() => {
		let cancelled = false;
		const refresh = () =>
			fetch("/api/ecosystem")
				.then((r) => (r.ok ? r.json() : []))
				.then((j) => {
					if (!cancelled) setList(j as EcosystemAgent[]);
				})
				.catch(() => {});
		refresh();
		const t = setInterval(refresh, 5000);
		return () => {
			cancelled = true;
			clearInterval(t);
		};
	}, [tick]);
	return { list, reload: () => setTick((n) => n + 1) };
}

const FOLDERS = [
	{ to: "/inbox", label: "Inbox", icon: TrayIcon },
	{ to: "/sent", label: "Sent", icon: PaperPlaneTiltIcon },
	{ to: "/drafts", label: "Drafts", icon: FileIcon },
	{ to: "/archive", label: "Archive", icon: ArchiveIcon },
] as const;

export function Sidebar() {
	const agents = useUI((s) => s.agents);
	const openRegister = useUI((s) => s.openRegister);
	const openCompose = useUI((s) => s.openCompose);
	const drafts = useUI((s) => s.drafts);
	const [showAdd, setShowAdd] = useState(false);
	const { list: ecosystem, reload: reloadEcosystem } = useEcosystem();

	return (
		<aside className="flex w-[256px] shrink-0 flex-col border-r border-[--color-border-soft] bg-[--color-sidebar]">
			{/* Brand */}
			<div className="flex items-center gap-2.5 border-b border-[--color-border-soft] px-4 py-4">
				<img
					src="/bindu.png"
					alt="Bindu"
					className="h-8 w-8 shrink-0 select-none"
					draggable={false}
				/>
				<div>
					<div className="text-[10px] uppercase tracking-[0.2em] text-fg-dim">
						Bindu
					</div>
					<div className="text-[14px] font-medium text-fg">Communications</div>
				</div>
			</div>

			{/* Compose — hero action, Gmail-shape */}
			<div className="px-3 pt-4">
				<button
					type="button"
					onClick={openCompose}
					className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-[--color-cobalt] px-4 py-3 text-left text-[14px] font-semibold text-white shadow-md transition hover:bg-[--color-cobalt-strong] hover:shadow-lg"
				>
					<PencilSimpleIcon size={18} weight="bold" />
					<span>Compose</span>
				</button>
			</div>

			{/* Folders */}
			<nav className="px-3 pt-3">
				{FOLDERS.map((f) => (
					<NavLink
						key={f.to}
						to={f.to}
						className={({ isActive }) =>
							clsx(
								"flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] transition",
								isActive
									? "bg-[--color-cobalt-soft] font-medium text-fg"
									: "text-fg-muted hover:bg-[--color-row-hover]",
							)
						}
					>
						<f.icon size={16} weight="duotone" />
						<span className="flex-1">{f.label}</span>
						{f.to === "/drafts" && drafts.length > 0 && (
							<span className="rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">
								{drafts.length}
							</span>
						)}
					</NavLink>
				))}
			</nav>

			{/* Ecosystem — contacts / known agents */}
			<div className="mt-5 px-3">
				<div className="flex items-center justify-between px-3 pb-1.5">
					<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-fg-dim">
						<GlobeIcon size={11} weight="bold" />
						Contacts
					</div>
					<button
						type="button"
						onClick={() => setShowAdd(true)}
						title="Add agent by URL"
						className="rounded p-0.5 text-fg-dim transition hover:bg-slate-100 hover:text-[--color-cobalt]"
					>
						<PlusIcon size={12} weight="bold" />
					</button>
				</div>
				{ecosystem.length === 0 ? (
					<div className="px-3 py-1 text-[10px] text-fg-dim">
						No contacts. Click + to add.
					</div>
				) : (
					ecosystem.map((a) => {
						const name = a.agentCard?.name ?? a.id;
						const didId = a.did?.id ?? `did:bindu:?:${a.id}`;
						return (
							<div
								key={a.id}
								className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left"
								title={didId}
							>
								<span
									className={clsx(
										"flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
										a.source === "manual"
											? "bg-[--color-cobalt-soft] text-[--color-cobalt-strong]"
											: "bg-yellow-100 text-yellow-800",
									)}
								>
									{a.source === "manual" ? "+" : "●"}
								</span>
								<div className="min-w-0 flex-1">
									<div className="truncate text-[12px] text-fg">{name}</div>
									<div className="truncate text-[10px] text-fg-dim">
										{shortDid(didId)}
									</div>
								</div>
							</div>
						);
					})
				)}
			</div>

			{/* Per-agent (debug) — lets devs/auditors inspect one agent's lane */}
			<div className="mt-5 px-3">
				<div className="flex items-center gap-1.5 px-3 pb-1.5 text-[10px] uppercase tracking-[0.15em] text-fg-dim">
					<GearIcon size={11} weight="bold" />
					Per-agent (debug)
				</div>
				{agents.map((a) => (
					<NavLink
						key={a.id}
						to={`/agents/${a.id}`}
						className={({ isActive }) =>
							clsx(
								"flex w-full items-center gap-2.5 rounded-md px-3 py-1 text-left transition",
								isActive
									? "bg-[--color-cobalt-soft] text-fg"
									: "text-fg-muted hover:bg-[--color-row-hover]",
							)
						}
					>
						<span className="text-[11px]">{a.name}</span>
					</NavLink>
				))}
			</div>

			{/* You + Register-agent footer */}
			<div className="mt-auto border-t border-[--color-border-soft] px-4 py-3">
				<button
					type="button"
					onClick={openRegister}
					className="mb-2 flex w-full items-center gap-1.5 rounded-md border border-[--color-border-soft] bg-white px-2 py-1 text-[10px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
					title="Register a new local agent (⌘N)"
				>
					<PlusIcon size={10} weight="bold" />
					Register agent
				</button>
				<div className="text-[10px] text-fg-dim">
					You: <span className="text-fg-muted">raahul@getbindu</span>
				</div>
				<div className="mt-0.5 text-[10px] text-fg-dim">
					did:bindu:raahul:0001
				</div>
			</div>

			<AddAgentModal
				open={showAdd}
				onClose={() => setShowAdd(false)}
				onAdded={() => reloadEcosystem()}
			/>
		</aside>
	);
}
