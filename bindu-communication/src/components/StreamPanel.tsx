import { useMemo } from "react";
import { useParams } from "react-router";
import clsx from "clsx";
import { WarningIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { agents, events } from "~/data/mock";
import { useUI } from "~/state";
import { shortDid } from "~/lib/format";
import { EventRow } from "./EventRow";

const FILTERS = ["all", "needs-attention", "completed", "untrusted"] as const;

export function StreamPanel() {
	const { agentId = "writer" } = useParams<{ agentId: string }>();
	const streamPaused = useUI((s) => s.streamPaused);
	const togglePause = useUI((s) => s.togglePause);
	const expandedTraces = useUI((s) => s.expandedTraces);

	const agent = agents.find((a) => a.id === agentId) ?? agents[0];

	const visible = useMemo(() => {
		const list = events
			.filter((e) => e.agentId === agentId)
			.sort((a, b) => b.ts.localeCompare(a.ts));
		const out: typeof list = [];
		for (const e of list) {
			if (e.parentId) continue;
			out.push(e);
			if (expandedTraces.has(e.id)) {
				out.push(...list.filter((c) => c.parentId === e.id));
			}
		}
		return out;
	}, [agentId, expandedTraces]);

	const childrenIds = useMemo(
		() => new Set(events.filter((e) => e.parentId).map((e) => e.parentId!)),
		[],
	);

	const attention = visible.filter((e) => e.needsAttention);
	const feed = visible.filter((e) => !e.needsAttention);

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			{/* Header */}
			<header className="flex items-center justify-between border-b border-[--color-border-soft] bg-[--color-panel] px-6 py-3">
				<div className="flex items-baseline gap-3">
					<h1 className="text-[14px] font-medium text-fg">{agent.name}</h1>
					<span className="text-[11px] text-fg-dim">{shortDid(agent.did)}</span>
				</div>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1.5 text-[11px]">
						<span
							className={clsx(
								"inline-block h-1.5 w-1.5 rounded-full",
								streamPaused
									? "bg-yellow-400"
									: "live-pulse bg-[--color-cobalt]",
							)}
						/>
						<span className="text-fg-muted">
							{streamPaused ? "paused" : "live"}
						</span>
					</div>
					<button
						type="button"
						onClick={togglePause}
						className="flex items-center gap-1.5 rounded-md border border-[--color-border] bg-white px-2 py-1 text-[11px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
					>
						{streamPaused ? (
							<PlayIcon size={11} weight="fill" />
						) : (
							<PauseIcon size={11} weight="fill" />
						)}
						{streamPaused ? "Resume" : "Pause"}
					</button>
				</div>
			</header>

			{/* Filters */}
			<div className="flex items-center gap-2 border-b border-[--color-border-soft] px-6 py-2.5">
				<span className="text-[10px] uppercase tracking-[0.15em] text-fg-dim">
					Filters
				</span>
				{FILTERS.map((f, i) => (
					<button
						key={f}
						type="button"
						className={clsx(
							"rounded-full border px-2.5 py-0.5 text-[11px] transition",
							i === 0
								? "border-[--color-cobalt] bg-[--color-cobalt-soft] text-[--color-cobalt-strong]"
								: "border-[--color-border-soft] text-fg-dim hover:border-[--color-cobalt] hover:text-[--color-cobalt]",
						)}
					>
						{f}
					</button>
				))}
			</div>

			{/* Body */}
			<div className="scrollbar flex-1 overflow-y-auto">
				{attention.length > 0 && (
					<section className="border-b border-yellow-300/60 bg-yellow-50/60">
						<div className="flex items-center justify-between px-6 pb-2 pt-3">
							<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-yellow-800">
								<WarningIcon size={12} weight="fill" />
								Needs Attention ({attention.length})
							</div>
							<span className="text-[10px] text-fg-dim">
								your input unblocks the agent
							</span>
						</div>
						{attention.map((e) => (
							<EventRow
								key={e.id}
								event={e}
								hasChildren={childrenIds.has(e.id)}
								indented={!!e.parentId}
								attentionLane
							/>
						))}
					</section>
				)}

				<div className="px-6 pb-2 pt-4 text-[10px] uppercase tracking-[0.15em] text-fg-dim">
					Live feed
				</div>
				{feed.map((e) => (
					<EventRow
						key={e.id}
						event={e}
						hasChildren={childrenIds.has(e.id)}
						indented={!!e.parentId}
						attentionLane={false}
					/>
				))}
				{feed.length === 0 && attention.length === 0 && (
					<div className="flex h-40 items-center justify-center text-[12px] text-fg-dim">
						No events for this agent.
					</div>
				)}
			</div>
		</main>
	);
}
