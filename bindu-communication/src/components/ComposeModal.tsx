import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import {
	XIcon,
	PaperPlaneTiltIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { shortDid } from "~/lib/format";
import { useUI } from "~/state";
import { Modal } from "./Modal";
import { postJson } from "~/lib/fetch";
import { OUTBOX_AGENT_ID } from "~/lib/constants";
import type { EcosystemAgent } from "~/lib/api-types";

interface Props {
	open: boolean;
	onClose: () => void;
}

export function ComposeModal({ open, onClose }: Props) {
	const navigate = useNavigate();
	const composeDraftId = useUI((s) => s.composeDraftId);
	const drafts = useUI((s) => s.drafts);
	const saveDraft = useUI((s) => s.saveDraft);
	const deleteDraft = useUI((s) => s.deleteDraft);

	const [agents, setAgents] = useState<EcosystemAgent[]>([]);
	const [agentId, setAgentId] = useState("");
	const [text, setText] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
	const [errMsg, setErrMsg] = useState<string | null>(null);
	// Local draft id — generated when this compose session creates a draft.
	const [draftId, setDraftId] = useState<string | null>(null);
	const sentRef = useRef(false);

	// Load ecosystem and seed defaults / hydrate from a draft.
	useEffect(() => {
		if (!open) return;
		setStatus("idle");
		setErrMsg(null);
		sentRef.current = false;

		const draftToLoad = composeDraftId
			? drafts.find((d) => d.id === composeDraftId)
			: null;
		setDraftId(draftToLoad?.id ?? null);
		setText(draftToLoad?.text ?? "");

		fetch("/api/ecosystem")
			.then((r) => (r.ok ? r.json() : []))
			.then((j: EcosystemAgent[]) => {
				const filtered = j.filter((a) => a.id !== OUTBOX_AGENT_ID);
				setAgents(filtered);
				if (draftToLoad?.agentId) {
					setAgentId(draftToLoad.agentId);
				} else if (filtered[0]) {
					setAgentId(filtered[0].id);
				}
			})
			.catch(() => {});
	}, [open, composeDraftId, drafts]);

	// Auto-save on close (unless we just sent it).
	const saveOnClose = () => {
		if (sentRef.current) return;
		const trimmed = text.trim();
		if (!trimmed || !agentId) {
			// Empty close: drop the draft if we were editing one.
			if (draftId) deleteDraft(draftId);
			return;
		}
		const id = draftId ?? crypto.randomUUID();
		saveDraft({
			id,
			agentId,
			text: trimmed,
			savedAt: new Date().toISOString(),
		});
	};

	function handleCloseClick() {
		saveOnClose();
		onClose();
	}

	function handleDiscard() {
		if (draftId) deleteDraft(draftId);
		sentRef.current = true; // skip save-on-close
		onClose();
	}

	const canSubmit = useMemo(
		() =>
			agentId.length > 0 && text.trim().length > 0 && status !== "sending",
		[agentId, text, status],
	);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		setStatus("sending");
		setErrMsg(null);
		const r = await postJson("/api/compose", { agentId, text: text.trim() });
		if (!r.ok) {
			setStatus("error");
			setErrMsg(r.errMsg);
			return;
		}
		// Successful send — clear any draft we were editing.
		if (draftId) deleteDraft(draftId);
		sentRef.current = true;
		navigate("/sent");
		onClose();
	}

	return (
		<Modal open={open} onClose={handleCloseClick}>
			<form
				onSubmit={handleSubmit}
				className="w-[560px] max-w-[92vw] rounded-lg border border-[--color-border] bg-white shadow-2xl"
			>
				<div className="flex items-center gap-2.5 border-b border-[--color-border-soft] px-5 py-3">
					<PaperPlaneTiltIcon
						size={18}
						weight="duotone"
						className="text-[--color-cobalt]"
					/>
					<div className="flex-1">
						<h2 className="text-[14px] font-medium text-fg">
							{draftId ? "Resume draft" : "New request"}
						</h2>
						<div className="text-[10px] text-fg-dim">
							Send a message to an agent in your ecosystem. From: your operator DID.
						</div>
					</div>
					<button
						type="button"
						onClick={handleCloseClick}
						className="rounded p-1 text-fg-dim transition hover:bg-slate-100 hover:text-fg"
					>
						<XIcon size={14} weight="bold" />
					</button>
				</div>

				<div className="space-y-4 px-5 py-5">
					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							To
						</label>
						{agents.length === 0 ? (
							<div className="mt-1.5 rounded-md border border-dashed border-[--color-border] bg-slate-50 px-3 py-2 text-[12px] text-fg-dim">
								No agents in your ecosystem yet. Add one from the sidebar first.
							</div>
						) : (
							<select
								value={agentId}
								onChange={(e) => setAgentId(e.target.value)}
								className="mt-1.5 w-full rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] text-fg outline-none transition focus:border-[--color-cobalt] focus:ring-2 focus:ring-[--color-cobalt-soft]"
							>
								{agents.map((a) => {
									const name = a.agentCard?.name ?? a.id;
									const did = a.did?.id;
									return (
										<option key={a.id} value={a.id}>
											{name}
											{did ? ` · ${shortDid(did)}` : ` · ${a.id}`}
										</option>
									);
								})}
							</select>
						)}
					</div>

					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							Body
						</label>
						<textarea
							autoFocus
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Type the request body…"
							rows={5}
							className="mt-1.5 w-full resize-y rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] text-fg placeholder-fg-faint outline-none transition focus:border-[--color-cobalt] focus:ring-2 focus:ring-[--color-cobalt-soft]"
						/>
						<div className="mt-1 text-[10px] text-fg-dim">
							Closing without sending saves a draft.
						</div>
					</div>

					{status === "error" && errMsg && (
						<div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
							✗ {errMsg}
						</div>
					)}
				</div>

				<div className="flex items-center justify-between gap-2 border-t border-[--color-border-soft] bg-slate-50 px-5 py-3">
					{draftId ? (
						<button
							type="button"
							onClick={handleDiscard}
							className="flex items-center gap-1.5 rounded-md border border-[--color-border] bg-white px-3 py-1.5 text-[12px] text-rose-700 transition hover:border-rose-300 hover:bg-rose-50"
						>
							<TrashIcon size={11} weight="bold" />
							Discard draft
						</button>
					) : (
						<span />
					)}
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleCloseClick}
							className="rounded-md border border-[--color-border] bg-white px-3 py-1.5 text-[12px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
						>
							{text.trim() ? "Save & close" : "Cancel"}
						</button>
						<button
							type="submit"
							disabled={!canSubmit || agents.length === 0}
							className={clsx(
								"rounded-md px-3 py-1.5 text-[12px] font-medium shadow-sm transition",
								canSubmit && agents.length > 0
									? "bg-[--color-cobalt] text-white hover:bg-[--color-cobalt-strong]"
									: "bg-slate-200 text-slate-400",
							)}
						>
							{status === "sending" ? "Sending…" : "Send request"}
						</button>
					</div>
				</div>
			</form>
		</Modal>
	);
}
