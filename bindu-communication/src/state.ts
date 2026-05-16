import { create } from "zustand";
import type { Agent, AgentRole, DetailTab, StreamEvent } from "~/types";
import { agents as seedAgents } from "~/data/mock";

export type TrustPolicy =
	| "fully-supervised"
	| "policy-driven"
	| "fully-autonomous";

export interface NewAgentDraft {
	name: string;
	role: AgentRole;
	did: string;
	trustPolicy: TrustPolicy;
}

interface UIState {
	selectedEventId: string | null;
	selectedThreadId: string | null;
	detailTab: DetailTab;
	streamPaused: boolean;
	expandedTraces: Set<string>;
	scopeFilter: string | null;
	showRegister: boolean;
	showCompose: boolean;
	agents: Agent[];
	liveEvents: StreamEvent[];
	/** ctx ids the user has explicitly marked read */
	readOverrides: Set<string>;
	/** ctx ids the user has explicitly marked unread (overrides everything) */
	unreadOverrides: Set<string>;
	/** ctx ids the user has archived (hidden from inbox/sent, visible in archive folder) */
	archivedThreads: Set<string>;

	selectEvent: (id: string | null) => void;
	selectThread: (contextId: string | null) => void;
	setDetailTab: (tab: DetailTab) => void;
	togglePause: () => void;
	toggleTrace: (id: string) => void;
	setScope: (id: string | null) => void;
	openRegister: () => void;
	closeRegister: () => void;
	openCompose: () => void;
	closeCompose: () => void;
	registerAgent: (draft: NewAgentDraft) => Agent;
	addLiveEvent: (e: StreamEvent) => void;
	markRead: (contextId: string) => void;
	markUnread: (contextId: string) => void;
	archiveThread: (contextId: string) => void;
	unarchiveThread: (contextId: string) => void;
}

const READ_LS_KEY = "bindu-comms:read-overrides";
const UNREAD_LS_KEY = "bindu-comms:unread-overrides";
const ARCHIVE_LS_KEY = "bindu-comms:archived-threads";

function loadSet(key: string): Set<string> {
	if (typeof window === "undefined") return new Set();
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return new Set();
		const arr = JSON.parse(raw) as unknown;
		if (!Array.isArray(arr)) return new Set();
		return new Set(arr.filter((x): x is string => typeof x === "string"));
	} catch {
		return new Set();
	}
}

function saveSet(key: string, s: Set<string>): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(key, JSON.stringify(Array.from(s)));
	} catch {
		// quota or denied — just skip persistence
	}
}

export const useUI = create<UIState>((set) => ({
	selectedEventId: "wa-7",
	selectedThreadId: null,
	detailTab: "glance",
	streamPaused: false,
	expandedTraces: new Set(["plan-1"]),
	scopeFilter: null,
	showRegister: false,
	showCompose: false,
	agents: seedAgents,
	liveEvents: [],
	readOverrides: loadSet(READ_LS_KEY),
	unreadOverrides: loadSet(UNREAD_LS_KEY),
	archivedThreads: loadSet(ARCHIVE_LS_KEY),

	selectEvent: (id) => set({ selectedEventId: id }),
	selectThread: (contextId) =>
		set((s) => {
			// Opening a thread implicitly marks it read.
			if (!contextId) return { selectedThreadId: null };
			const read = new Set(s.readOverrides);
			const unread = new Set(s.unreadOverrides);
			read.add(contextId);
			unread.delete(contextId);
			saveSet(READ_LS_KEY, read);
			saveSet(UNREAD_LS_KEY, unread);
			return {
				selectedThreadId: contextId,
				readOverrides: read,
				unreadOverrides: unread,
			};
		}),
	setDetailTab: (tab) => set({ detailTab: tab }),
	togglePause: () => set((s) => ({ streamPaused: !s.streamPaused })),
	toggleTrace: (id) =>
		set((s) => {
			const next = new Set(s.expandedTraces);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return { expandedTraces: next };
		}),
	setScope: (id) =>
		set((s) => ({ scopeFilter: s.scopeFilter === id ? null : id })),
	openRegister: () => set({ showRegister: true }),
	closeRegister: () => set({ showRegister: false }),
	openCompose: () => set({ showCompose: true }),
	closeCompose: () => set({ showCompose: false }),
	registerAgent: (draft) => {
		const id = draft.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "")
			|| `agent-${Math.random().toString(36).slice(2, 6)}`;
		const newAgent: Agent = {
			id,
			name: draft.name,
			did: draft.did,
			unread: 0,
			needsAttention: 0,
			role: draft.role,
		};
		set((s) => ({ agents: [...s.agents, newAgent], showRegister: false }));
		return newAgent;
	},
	markRead: (contextId) =>
		set((s) => {
			const read = new Set(s.readOverrides);
			const unread = new Set(s.unreadOverrides);
			read.add(contextId);
			unread.delete(contextId);
			saveSet(READ_LS_KEY, read);
			saveSet(UNREAD_LS_KEY, unread);
			return { readOverrides: read, unreadOverrides: unread };
		}),
	markUnread: (contextId) =>
		set((s) => {
			const read = new Set(s.readOverrides);
			const unread = new Set(s.unreadOverrides);
			read.delete(contextId);
			unread.add(contextId);
			saveSet(READ_LS_KEY, read);
			saveSet(UNREAD_LS_KEY, unread);
			return { readOverrides: read, unreadOverrides: unread };
		}),
	archiveThread: (contextId) =>
		set((s) => {
			const archived = new Set(s.archivedThreads);
			archived.add(contextId);
			saveSet(ARCHIVE_LS_KEY, archived);
			// Closing the thread on archive matches Gmail UX: the row disappears
			// from the visible folder and the panel collapses.
			return {
				archivedThreads: archived,
				selectedThreadId:
					s.selectedThreadId === contextId ? null : s.selectedThreadId,
			};
		}),
	unarchiveThread: (contextId) =>
		set((s) => {
			const archived = new Set(s.archivedThreads);
			archived.delete(contextId);
			saveSet(ARCHIVE_LS_KEY, archived);
			return { archivedThreads: archived };
		}),
	addLiveEvent: (e) =>
		set((s) => {
			const agents = s.agents.find((a) => a.id === e.agentId)
				? s.agents
				: [
						...s.agents,
						{
							id: e.agentId,
							name: e.agentId,
							did: `did:bindu:?:${e.agentId}`,
							unread: 0,
							needsAttention: 0,
							role: "agent" as const,
						},
					];
			return { liveEvents: [e, ...s.liveEvents].slice(0, 500), agents };
		}),
}));
