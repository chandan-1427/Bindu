import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import {
	PlusIcon,
	GlobeIcon,
	TrayIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	ArchiveIcon,
	FileIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useUI } from "~/state";
import { shortDid } from "~/lib/format";
import { AddAgentModal } from "./AddAgentModal";
import type { EcosystemAgent } from "~/lib/api-types";
import clsx from "clsx";

function useEcosystem() {
	const [list, setList] = useState<EcosystemAgent[]>([]);
	const [tick, setTick] = useState(0);
	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			// Skip when the tab isn't visible — no point hammering
			// /api/ecosystem every 5s in a background tab. The
			// visibilitychange listener below kicks an immediate refresh
			// the moment the user comes back.
			if (typeof document !== "undefined" && document.hidden) return;
			fetch("/api/ecosystem")
				.then((r) => (r.ok ? r.json() : []))
				.then((j) => {
					if (!cancelled) setList(j as EcosystemAgent[]);
				})
				.catch(() => {});
		};
		refresh();
		const t = setInterval(refresh, 5000);
		const onVis = () => {
			if (!document.hidden) refresh();
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			cancelled = true;
			clearInterval(t);
			document.removeEventListener("visibilitychange", onVis);
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

/**
 * Some agno-based agents don't publish /.well-known/did.json but DO embed
 * their DID inside agent_card.capabilities.extensions[].uri. Pull it from
 * there so the Contacts row shows the real DID instead of a "?" placeholder.
 */
function pickDidFromCard(
	card: { capabilities?: { extensions?: Array<{ uri?: string }> } | unknown } | null | undefined,
): string | null {
	const caps = (card?.capabilities ?? {}) as {
		extensions?: Array<{ uri?: string }>;
	};
	const exts = Array.isArray(caps.extensions) ? caps.extensions : [];
	for (const x of exts) {
		if (typeof x?.uri === "string" && x.uri.startsWith("did:")) return x.uri;
	}
	return null;
}

export function Sidebar() {
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

			{/* Ecosystem — contacts / known agents.
			    flex-1 + min-h-0 here so this section consumes the remaining
			    sidebar height, and the inner list scrolls when the contact
			    count overflows. Brand / Compose / Folders stay pinned at
			    the top; Register-agent + You stay pinned at the bottom. */}
			<div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
				<div className="flex shrink-0 items-center justify-between px-3 pb-1.5">
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
				<div className="scrollbar min-h-0 flex-1 overflow-y-auto">
					{(() => {
						// Hide the synthetic outbox bucket; it's the operator's
						// "Sent" folder, not a contact you'd ever write to.
						const visible = ecosystem.filter((a) => a.id !== "outbox");
						if (visible.length === 0) {
							return (
								<div className="px-3 py-1 text-[10px] text-fg-dim">
									No contacts. Click + to add.
								</div>
							);
						}
						return visible.map((a) => {
							const name = a.agentCard?.name ?? a.id;
							const didFromCard = pickDidFromCard(a.agentCard);
							const realDid = a.did?.id ?? didFromCard;
							const subline = realDid
								? shortDid(realDid)
								: a.url ?? "no URL yet";
							return (
								<div
									key={a.id}
									className="group flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left hover:bg-[--color-row-hover]"
									title={realDid ?? a.url ?? a.id}
								>
									<span
										className="flex h-6 w-6 shrink-0 items-center justify-center text-[15px] leading-none"
										aria-hidden
									>
										🌻
									</span>
									<div className="min-w-0 flex-1">
										<div className="truncate text-[12px] text-fg">{name}</div>
										<div className="truncate text-[10px] text-fg-dim">
											{subline}
										</div>
									</div>
									<button
										type="button"
										onClick={async (ev) => {
											ev.stopPropagation();
											if (!window.confirm(`Remove ${name} from contacts?`)) return;
											await fetch(`/api/ecosystem/${encodeURIComponent(a.id)}`, {
												method: "DELETE",
											}).catch(() => {});
											reloadEcosystem();
										}}
										title="Remove contact"
										className="shrink-0 rounded p-1 text-fg-dim opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-700"
									>
										<TrashIcon size={11} weight="bold" />
									</button>
								</div>
							);
						});
					})()}
				</div>
			</div>

			{/* You — operator identity */}
			<div className="mt-auto border-t border-[--color-border-soft] px-4 py-3">
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
