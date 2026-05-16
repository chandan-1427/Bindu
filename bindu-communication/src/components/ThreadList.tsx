import clsx from "clsx";
import {
	ArchiveIcon,
	ArrowArcLeftIcon,
	ArrowBendUpLeftIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useUI } from "~/state";
import {
	groupByThread,
	shortContextId,
	type Thread,
} from "~/lib/threads";
import type { StreamEvent } from "~/types";

interface Props {
	events: StreamEvent[];
	mode?: "inbox" | "sent" | "archive";
	query?: string;
}

function matchesQuery(t: Thread, q: string): boolean {
	if (!q) return true;
	const needle = q.toLowerCase();
	const e = t.latest;
	if (e.counterparty.name.toLowerCase().includes(needle)) return true;
	if (e.counterparty.did.toLowerCase().includes(needle)) return true;
	if (e.summary.toLowerCase().includes(needle)) return true;
	if (t.contextId.toLowerCase().includes(needle)) return true;
	if (e.payload) {
		try {
			const p = JSON.parse(e.payload) as Record<string, unknown>;
			const text = typeof p.text === "string" ? (p.text as string).toLowerCase() : "";
			if (text.includes(needle)) return true;
			const eventType = typeof p.event_type === "string" ? (p.event_type as string).toLowerCase() : "";
			if (eventType.includes(needle)) return true;
		} catch {
			// no-op
		}
	}
	return false;
}

const OUTBOX_AGENT_ID = "outbox";

/**
 * Gmail-shape thread list. Each row mirrors the agentic-inbox layout:
 *
 *   • dot · sender · count · needs-reply · date          [hover: mark read/unread]
 *                                          subject — snippet
 *
 * "Unread" is computed from explicit overrides first, then falls back to
 * attentionCount > 0. Overrides persist to localStorage so the user's
 * triage state survives refreshes.
 */
export function ThreadList({ events, mode = "inbox", query = "" }: Props) {
	const selectThread = useUI((s) => s.selectThread);
	const selectEvent = useUI((s) => s.selectEvent);
	const readOverrides = useUI((s) => s.readOverrides);
	const unreadOverrides = useUI((s) => s.unreadOverrides);
	const markRead = useUI((s) => s.markRead);
	const markUnread = useUI((s) => s.markUnread);
	const archiveThread = useUI((s) => s.archiveThread);
	const unarchiveThread = useUI((s) => s.unarchiveThread);
	const allThreads = groupByThread(events);
	const threads = query
		? allThreads.filter((t) => matchesQuery(t, query))
		: allThreads;

	function isUnread(t: Thread): boolean {
		if (unreadOverrides.has(t.contextId)) return true;
		if (readOverrides.has(t.contextId)) return false;
		return t.attentionCount > 0;
	}

	if (threads.length === 0) {
		const isFiltered = !!query && allThreads.length > 0;
		return (
			<div className="flex flex-col items-center justify-center px-6 py-24 text-center">
				<TrayIcon size={48} weight="thin" className="mb-4 text-fg-dim" />
				<h3 className="mb-1 text-[15px] font-semibold text-fg">
					{isFiltered ? "No matches" : "Nothing to show"}
				</h3>
				<p className="max-w-xs text-[12px] text-fg-muted">
					{isFiltered
						? `No threads matched “${query}”. Clear the search to see all threads.`
						: "When a thread arrives in this folder, it'll appear here."}
				</p>
			</div>
		);
	}

	function open(t: Thread) {
		selectThread(t.contextId);
		selectEvent(t.latest.id);
	}

	return (
		<div>
			{threads.map((t) => (
				<ThreadRow
					key={t.contextId}
					thread={t}
					unread={isUnread(t)}
					mode={mode}
					onOpen={open}
					onMarkRead={() => markRead(t.contextId)}
					onMarkUnread={() => markUnread(t.contextId)}
					onArchive={() => archiveThread(t.contextId)}
					onUnarchive={() => unarchiveThread(t.contextId)}
				/>
			))}
		</div>
	);
}

function ThreadRow({
	thread,
	unread,
	mode,
	onOpen,
	onMarkRead,
	onMarkUnread,
	onArchive,
	onUnarchive,
}: {
	thread: Thread;
	unread: boolean;
	mode: "inbox" | "sent" | "archive";
	onOpen: (t: Thread) => void;
	onMarkRead: () => void;
	onMarkUnread: () => void;
	onArchive: () => void;
	onUnarchive: () => void;
}) {
	const e = thread.latest;
	const isUnread = unread;
	const isOutbound = e.agentId === OUTBOX_AGENT_ID;

	// Sender / recipient label: in /inbox we show "From: name"; in /sent
	// the latest event is outbound so we show "To: name".
	const counterpartyName =
		e.counterparty.name === "task"
			? shortContextId(thread.contextId)
			: e.counterparty.name;
	const fromLabel = isOutbound ? `To: ${counterpartyName}` : counterpartyName;

	// Subject = first message's text if we know it (outbound has text on
	// the payload), otherwise the latest summary. Snippet = latest summary.
	const subject = subjectFor(thread);
	const snippet = e.summary;

	return (
		<button
			type="button"
			onClick={() => onOpen(thread)}
			className={clsx(
				"group flex w-full cursor-pointer items-center gap-3 border-b border-[--color-border-soft] px-4 py-2.5 text-left transition hover:bg-[--color-row-hover] md:px-6 md:py-3",
				isUnread && "bg-yellow-50/40",
			)}
		>
			{/* Unread dot */}
			<div className="flex w-2.5 shrink-0 justify-center">
				{isUnread && (
					<span className="h-2 w-2 rounded-full bg-[--color-cobalt]" />
				)}
			</div>

			{/* Content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span
						className={clsx(
							"truncate text-[13px]",
							isUnread
								? "font-semibold text-fg"
								: "text-fg-muted",
						)}
					>
						{fromLabel}
					</span>
					{thread.totalCount > 1 && (
						<span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
							{thread.totalCount}
						</span>
					)}
					{isUnread && (
						<span
							className="shrink-0 text-[--color-sunflower-strong]"
							title="Needs your reply"
						>
							<ArrowBendUpLeftIcon size={12} weight="bold" />
						</span>
					)}
					<span className="ml-auto shrink-0 text-[11px] text-fg-dim">
						{e.relTs}
					</span>
					{/* Hover actions — read/unread + archive/restore */}
					<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
						<button
							type="button"
							onClick={(ev) => {
								ev.stopPropagation();
								if (isUnread) onMarkRead();
								else onMarkUnread();
							}}
							title={isUnread ? "Mark as read" : "Mark as unread"}
							className="rounded p-1 text-fg-dim hover:bg-slate-100 hover:text-[--color-cobalt]"
						>
							{isUnread ? (
								<EnvelopeOpenIcon size={13} weight="bold" />
							) : (
								<EnvelopeSimpleIcon size={13} weight="bold" />
							)}
						</button>
						{mode === "archive" ? (
							<button
								type="button"
								onClick={(ev) => {
									ev.stopPropagation();
									onUnarchive();
								}}
								title="Restore to inbox"
								className="rounded p-1 text-fg-dim hover:bg-slate-100 hover:text-[--color-cobalt]"
							>
								<ArrowArcLeftIcon size={13} weight="bold" />
							</button>
						) : (
							<button
								type="button"
								onClick={(ev) => {
									ev.stopPropagation();
									onArchive();
								}}
								title="Archive"
								className="rounded p-1 text-fg-dim hover:bg-slate-100 hover:text-[--color-cobalt]"
							>
								<ArchiveIcon size={13} weight="bold" />
							</button>
						)}
					</div>
				</div>
				<div className="mt-0.5 truncate text-[12px]">
					<span
						className={clsx(
							isUnread ? "font-medium text-fg" : "text-fg-muted",
						)}
					>
						{subject}
					</span>
					{snippet && snippet !== subject && (
						<span className="text-fg-dim"> — {snippet}</span>
					)}
				</div>
			</div>
		</button>
	);
}

/**
 * Best-effort "subject line" for a thread:
 * - if the conversation contains an outbound event with a `text` body, use that
 *   (that's the operator's first prompt — true subject in Gmail terms).
 * - else fall back to a Thread-id-style label.
 *
 * We can't know the subject of an inbound-only conversation without the
 * recipient's task body. That's the data gap we flagged in Step 1.
 */
function subjectFor(thread: Thread): string {
	const e = thread.latest;
	try {
		const p = e.payload ? JSON.parse(e.payload) : null;
		if (p?.text && typeof p.text === "string") {
			return p.text;
		}
	} catch {
		// no-op
	}
	if (e.counterparty.name === "task") {
		return `Thread ${shortContextId(thread.contextId)}`;
	}
	return e.summary;
}

