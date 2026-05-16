import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import clsx from "clsx";
import {
	PauseIcon,
	PlayIcon,
	PencilSimpleIcon,
	TrayIcon,
	MagnifyingGlassIcon,
	XIcon,
} from "@phosphor-icons/react";
import { events as mockEvents } from "~/data/mock";
import { useUI } from "~/state";
import { shortDid } from "~/lib/format";
import { extractContextId } from "~/lib/threads";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";

type Folder = "inbox" | "sent" | "archive";
type Mode = { kind: "folder"; folder: Folder } | { kind: "agent"; agentId: string };

const OUTBOX_AGENT_ID = "outbox";

function useMode(): Mode {
	const loc = useLocation();
	const params = useParams<{ agentId: string }>();
	if (loc.pathname === "/sent") return { kind: "folder", folder: "sent" };
	if (loc.pathname === "/archive") return { kind: "folder", folder: "archive" };
	if (loc.pathname === "/inbox" || loc.pathname === "/")
		return { kind: "folder", folder: "inbox" };
	return { kind: "agent", agentId: params.agentId ?? "writer" };
}

export function StreamPanel() {
	const mode = useMode();
	const streamPaused = useUI((s) => s.streamPaused);
	const togglePause = useUI((s) => s.togglePause);
	const agents = useUI((s) => s.agents);
	const liveEvents = useUI((s) => s.liveEvents);
	const selectedThreadId = useUI((s) => s.selectedThreadId);
	const selectThread = useUI((s) => s.selectThread);
	const openCompose = useUI((s) => s.openCompose);
	const archivedThreads = useUI((s) => s.archivedThreads);
	const [query, setQuery] = useState("");

	// Clear the open thread + search when the user switches folder / agent —
	// a context_id and a search term belong to one selection, not another's.
	const modeKey = mode.kind === "folder" ? `folder:${mode.folder}` : `agent:${mode.agentId}`;
	useEffect(() => {
		selectThread(null);
		setQuery("");
	}, [modeKey, selectThread]);

	const filteredEvents = useMemo(() => {
		const all = [...liveEvents, ...mockEvents];
		const isArchived = (e: (typeof all)[number]) => {
			const ctx = extractContextId(e);
			return ctx ? archivedThreads.has(ctx) : false;
		};
		if (mode.kind === "agent") {
			return all.filter((e) => e.agentId === mode.agentId);
		}
		if (mode.folder === "archive") {
			return all.filter(isArchived);
		}
		if (mode.folder === "sent") {
			return all.filter((e) => e.agentId === OUTBOX_AGENT_ID && !isArchived(e));
		}
		// inbox = everything except outbound + not archived
		return all.filter((e) => e.agentId !== OUTBOX_AGENT_ID && !isArchived(e));
	}, [mode, liveEvents, archivedThreads]);

	const title =
		mode.kind === "folder"
			? mode.folder === "sent"
				? "Sent"
				: mode.folder === "archive"
					? "Archive"
					: "Inbox"
			: agents.find((a) => a.id === mode.agentId)?.name ?? mode.agentId;
	const subtitle =
		mode.kind === "folder"
			? mode.folder === "sent"
				? "Conversations you initiated"
				: mode.folder === "archive"
					? "Threads you set aside"
					: "Conversations from your ecosystem"
			: shortDid(agents.find((a) => a.id === mode.agentId)?.did ?? "");

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-[--color-border-soft] bg-[--color-panel] px-6 py-3">
				<div className="flex min-w-0 items-baseline gap-3">
					{mode.kind === "folder" && (
						<TrayIcon size={16} weight="duotone" className="text-fg-muted" />
					)}
					<h1 className="shrink-0 text-[14px] font-medium text-fg">{title}</h1>
					<span className="hidden truncate text-[11px] text-fg-dim md:inline">
						{subtitle}
					</span>
				</div>
				<div className="relative max-w-[320px] flex-1">
					<MagnifyingGlassIcon
						size={12}
						weight="bold"
						className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim"
					/>
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search in this folder…"
						className="w-full rounded-md border border-[--color-border-soft] bg-slate-50 py-1 pl-6 pr-7 text-[12px] text-fg placeholder-fg-faint outline-none transition focus:border-[--color-cobalt] focus:bg-white focus:ring-2 focus:ring-[--color-cobalt-soft]"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							title="Clear"
							className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-dim hover:bg-slate-200 hover:text-fg"
						>
							<XIcon size={10} weight="bold" />
						</button>
					)}
				</div>
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={openCompose}
						className="flex items-center gap-1.5 rounded-md bg-[--color-cobalt] px-2.5 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-[--color-cobalt-strong]"
					>
						<PencilSimpleIcon size={11} weight="fill" />
						Compose
					</button>
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
			{/* MailboxSplitView — list shrinks to 380px when a thread opens,
			    the thread renders to the right. On mobile the list hides
			    when a thread is open (the view takes the full width). */}
			<div className="flex min-h-0 flex-1">
				<div
					className={clsx(
						"flex min-h-0 flex-col",
						selectedThreadId
							? "hidden md:flex md:w-[380px] md:shrink-0 md:border-r md:border-[--color-border-soft]"
							: "flex-1",
					)}
				>
					<div className="scrollbar flex-1 overflow-y-auto">
						<ThreadList
							events={filteredEvents}
							mode={mode.kind === "folder" ? mode.folder : "inbox"}
							query={query}
						/>
					</div>
				</div>
				{selectedThreadId && (
					<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
						<ThreadView contextId={selectedThreadId} />
					</div>
				)}
			</div>
		</main>
	);
}
