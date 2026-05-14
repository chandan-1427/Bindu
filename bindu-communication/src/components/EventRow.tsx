import clsx from "clsx";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useUI } from "~/state";
import { kindGlyph, shortDid, stateMeta, trustMeta } from "~/lib/format";
import type { StreamEvent } from "~/types";

interface Props {
	event: StreamEvent;
	hasChildren: boolean;
	indented: boolean;
	attentionLane: boolean;
}

export function EventRow({ event, hasChildren, indented, attentionLane }: Props) {
	const selectedEventId = useUI((s) => s.selectedEventId);
	const selectEvent = useUI((s) => s.selectEvent);
	const expandedTraces = useUI((s) => s.expandedTraces);
	const toggleTrace = useUI((s) => s.toggleTrace);

	const isSelected = selectedEventId === event.id;
	const isExpanded = expandedTraces.has(event.id);
	const tb = trustMeta[event.counterparty.trust];
	const sb = event.state ? stateMeta[event.state] : null;

	return (
		<button
			type="button"
			onClick={() => selectEvent(event.id)}
			className={clsx(
				"group flex w-full items-start gap-3 border-b border-[--color-border-soft] px-6 py-2.5 text-left transition",
				isSelected
					? "bg-[--color-cobalt-soft]"
					: "hover:bg-[--color-row-hover]",
				indented && "pl-14",
				attentionLane && !isSelected && "bg-yellow-50/40",
			)}
		>
			<span className="mt-0.5 w-4 shrink-0 text-center text-[14px] text-fg-dim">
				{kindGlyph[event.kind]}
			</span>

			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					{hasChildren && (
						<span
							role="button"
							tabIndex={0}
							onClick={(e) => {
								e.stopPropagation();
								toggleTrace(event.id);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									toggleTrace(event.id);
								}
							}}
							className="-ml-1 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded text-fg-dim hover:bg-slate-200 hover:text-fg"
						>
							{isExpanded ? (
								<CaretDownIcon size={10} weight="bold" />
							) : (
								<CaretRightIcon size={10} weight="bold" />
							)}
						</span>
					)}
					<span className="text-[13px] text-fg">{event.counterparty.name}</span>
					<span className="text-[10px] text-fg-dim">
						{shortDid(event.counterparty.did)}
					</span>
					<span
						className={clsx(
							"rounded border px-1 text-[9px] uppercase tracking-wide",
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
								"rounded border px-1 text-[9px] uppercase tracking-wide",
								sb.bg,
								sb.color,
								sb.border,
							)}
						>
							{event.state}
						</span>
					)}
					{event.signed && (
						<span className="text-[10px] text-emerald-600">✓</span>
					)}
				</div>
				<div className="mt-0.5 truncate text-[12px] text-fg-muted">
					{event.summary}
				</div>
				{event.recipe && (
					<div className="mt-0.5 text-[10px] text-[--color-cobalt-strong]">
						recipe · {event.recipe}
					</div>
				)}
			</div>

			<div className="flex shrink-0 flex-col items-end gap-1">
				<span className="text-[10px] text-fg-dim">{event.relTs}</span>
				{event.action && (
					<span className="rounded-md bg-[--color-sunflower] px-2 py-0.5 text-[10px] font-medium text-yellow-900 group-hover:bg-[--color-sunflower-strong]">
						{event.action.label}
					</span>
				)}
			</div>
		</button>
	);
}
