import { NavLink } from "react-router";
import { PlusIcon } from "@phosphor-icons/react";
import { scopes } from "~/data/mock";
import { useUI } from "~/state";
import { shortDid } from "~/lib/format";
import clsx from "clsx";

export function Sidebar() {
	const scopeFilter = useUI((s) => s.scopeFilter);
	const setScope = useUI((s) => s.setScope);
	const agents = useUI((s) => s.agents);
	const openRegister = useUI((s) => s.openRegister);

	return (
		<aside className="flex w-[280px] shrink-0 flex-col border-r border-[--color-border-soft] bg-[--color-sidebar]">
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

			{/* Register agent */}
			<div className="px-3 pt-4">
				<button
					type="button"
					onClick={openRegister}
					className="group flex w-full items-center gap-2 rounded-md bg-[--color-cobalt] px-3 py-2 text-left text-[12px] font-medium text-white shadow-sm transition hover:bg-[--color-cobalt-strong]"
				>
					<PlusIcon size={14} weight="bold" />
					<span>Register agent</span>
					<span className="ml-auto rounded bg-white/15 px-1 text-[10px] text-white/80">
						⌘N
					</span>
				</button>
			</div>

			{/* Agents */}
			<nav className="px-3 pt-4">
				<div className="px-2 pb-2 text-[10px] uppercase tracking-[0.15em] text-fg-dim">
					Agents
				</div>
				{agents.map((a) => (
					<NavLink
						key={a.id}
						to={`/agents/${a.id}`}
						className={({ isActive }) =>
							clsx(
								"group flex w-full items-center justify-between rounded-md px-2 py-2 text-left transition",
								isActive
									? "bg-[--color-cobalt-soft] text-fg"
									: "text-fg-muted hover:bg-[--color-row-hover]",
							)
						}
					>
						<div className="flex min-w-0 items-center gap-2.5">
							{a.role === "gateway" ? (
								<span
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[--color-cobalt] text-[10px] font-semibold text-white"
									title="Gateway"
								>
									GW
								</span>
							) : (
								<img
									src="/bindu.png"
									alt=""
									className="h-7 w-7 shrink-0 select-none"
									draggable={false}
									title="Agent (bindu)"
								/>
							)}
							<div className="min-w-0">
								<div className="truncate text-[13px] text-fg">{a.name}</div>
								<div className="truncate text-[10px] text-fg-dim">
									{shortDid(a.did)}
								</div>
							</div>
						</div>
						{a.needsAttention > 0 ? (
							<span className="ml-2 rounded-full bg-[--color-sunflower] px-1.5 text-[10px] font-semibold text-yellow-900">
								{a.needsAttention}
							</span>
						) : a.unread > 0 ? (
							<span className="ml-2 rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">
								{a.unread}
							</span>
						) : null}
					</NavLink>
				))}
			</nav>

			{/* Scopes */}
			<div className="mt-6 px-3">
				<div className="px-2 pb-2 text-[10px] uppercase tracking-[0.15em] text-fg-dim">
					Scopes
				</div>
				{scopes.map((s) => (
					<button
						key={s.id}
						type="button"
						onClick={() => setScope(s.id)}
						className={clsx(
							"flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] transition",
							scopeFilter === s.id
								? "bg-[--color-cobalt-soft] text-fg"
								: "text-fg-muted hover:bg-[--color-row-hover]",
						)}
					>
						<span>#{s.name}</span>
						<span className="text-[10px] text-fg-dim">{s.count}</span>
					</button>
				))}
			</div>

			{/* You */}
			<div className="mt-auto border-t border-[--color-border-soft] px-4 py-3">
				<div className="text-[10px] text-fg-dim">
					You: <span className="text-fg-muted">raahul@getbindu</span>
				</div>
				<div className="mt-0.5 text-[10px] text-fg-dim">
					did:bindu:raahul:0001
				</div>
			</div>
		</aside>
	);
}
