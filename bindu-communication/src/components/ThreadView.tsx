import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useUI } from "~/state";
import { eventsInThread, shortContextId } from "~/lib/threads";
import { EventRow } from "./EventRow";
import { events as mockEvents } from "~/data/mock";

interface Props {
	contextId: string;
}

/**
 * One thread's events, oldest → newest. Reuses EventRow for each entry.
 *
 * Crucially the event source spans ALL agents (live + mock), not just the
 * agent whose lane the user is currently viewing. An A2A conversation
 * lives on a context_id; the operator-side outbound message and the
 * recipient agent's lifecycle responses share that context_id but land on
 * different agentIds (outbox vs the recipient). Stitching them here gives
 * the user one Gmail-style conversation instead of two half-conversations
 * sitting in separate lanes.
 *
 * The lane list stays per-agent — that's the inbox; the thread view is
 * the conversation.
 */
export function ThreadView({ contextId }: Props) {
	const selectThread = useUI((s) => s.selectThread);
	const liveEvents = useUI((s) => s.liveEvents);
	const ordered = eventsInThread([...liveEvents, ...mockEvents], contextId);
	const first = ordered[0];
	const counterpartyName = first?.counterparty.name ?? "—";
	const agentLanes = Array.from(new Set(ordered.map((e) => e.agentId)));

	return (
		<>
			<div className="flex items-center gap-2 border-b border-[--color-border-soft] bg-white px-6 py-2.5">
				<button
					type="button"
					onClick={() => selectThread(null)}
					className="flex items-center gap-1 rounded-md border border-[--color-border-soft] bg-white px-2 py-1 text-[11px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
				>
					<ArrowLeftIcon size={11} weight="bold" />
					Inbox
				</button>
				<div className="ml-2 flex min-w-0 flex-1 items-baseline gap-2">
					<h2 className="truncate text-[13px] font-medium text-fg">
						{counterpartyName === "task"
							? `Thread ${shortContextId(contextId)}`
							: counterpartyName}
					</h2>
					<span className="font-mono text-[10px] text-fg-dim">
						{shortContextId(contextId)}
					</span>
				</div>
				<div className="flex items-center gap-2 text-[10px] text-fg-dim">
					{agentLanes.length > 1 && (
						<span className="rounded-full border border-[--color-cobalt]/40 bg-[--color-cobalt-soft] px-1.5 py-0.5 text-[--color-cobalt-strong]">
							stitched across {agentLanes.length} lanes
						</span>
					)}
					<span>
						{ordered.length} message{ordered.length === 1 ? "" : "s"}
					</span>
				</div>
			</div>

			<div className="scrollbar flex-1 overflow-y-auto">
				{ordered.length === 0 ? (
					<div className="flex h-40 items-center justify-center text-[12px] text-fg-dim">
						No events in this thread.
					</div>
				) : (
					ordered.map((e) => (
						<EventRow
							key={e.id}
							event={e}
							hasChildren={false}
							indented={false}
							attentionLane={!!e.needsAttention}
						/>
					))
				)}
			</div>
		</>
	);
}
