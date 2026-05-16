import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.BINDU_COMMS_DB ?? "data/events.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
	CREATE TABLE IF NOT EXISTS events (
		id              TEXT PRIMARY KEY,
		agent_id        TEXT NOT NULL,
		received_at     TEXT NOT NULL,
		payload         TEXT NOT NULL,
		first_contact   INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS events_agent_received
		ON events (agent_id, received_at DESC);

	CREATE TABLE IF NOT EXISTS agents (
		id           TEXT PRIMARY KEY,
		url          TEXT,
		did          TEXT,
		agent_card   TEXT,
		resolved_at  TEXT,
		source       TEXT NOT NULL DEFAULT 'webhook',
		added_at     TEXT
	);

	CREATE TABLE IF NOT EXISTS contexts (
		agent_id        TEXT NOT NULL,
		context_id      TEXT NOT NULL,
		first_seen_at   TEXT NOT NULL,
		PRIMARY KEY (agent_id, context_id)
	);

	CREATE TABLE IF NOT EXISTS thread_state (
		context_id      TEXT PRIMARY KEY,
		read_at         TEXT,
		unread_at       TEXT,
		archived_at     TEXT
	);
`);

export interface EventRow {
	id: string;
	agentId: string;
	receivedAt: string;
	payload: Record<string, unknown>;
	firstContact: boolean;
}

// Defensive: older DB files may predate first_contact. Add the column when
// missing so we don't crash on startup after the schema bump.
const eventColumns = db
	.prepare("PRAGMA table_info(events)")
	.all() as Array<{ name: string }>;
if (!eventColumns.some((c) => c.name === "first_contact")) {
	db.exec("ALTER TABLE events ADD COLUMN first_contact INTEGER NOT NULL DEFAULT 0");
}
const agentColumns = db
	.prepare("PRAGMA table_info(agents)")
	.all() as Array<{ name: string }>;
if (!agentColumns.some((c) => c.name === "source")) {
	db.exec("ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'webhook'");
}
if (!agentColumns.some((c) => c.name === "added_at")) {
	db.exec("ALTER TABLE agents ADD COLUMN added_at TEXT");
}

const insertEvent = db.prepare(
	"INSERT OR REPLACE INTO events (id, agent_id, received_at, payload, first_contact) VALUES (?, ?, ?, ?, ?)",
);
const trimEvents = db.prepare(
	`DELETE FROM events WHERE id IN (
		SELECT id FROM events ORDER BY received_at DESC LIMIT -1 OFFSET ?
	)`,
);
const recentEvents = db.prepare(
	"SELECT id, agent_id AS agentId, received_at AS receivedAt, payload, first_contact AS firstContact FROM events ORDER BY received_at ASC LIMIT ?",
);
const distinctAgents = db.prepare(
	"SELECT DISTINCT agent_id AS agentId FROM events",
);
const upsertContext = db.prepare(
	"INSERT OR IGNORE INTO contexts (agent_id, context_id, first_seen_at) VALUES (?, ?, ?)",
);
const getAgent = db.prepare(
	"SELECT id, url, did, agent_card AS agentCard, resolved_at AS resolvedAt, source, added_at AS addedAt FROM agents WHERE id = ?",
);
const listAllAgents = db.prepare(
	"SELECT id, url, did, agent_card AS agentCard, resolved_at AS resolvedAt, source, added_at AS addedAt FROM agents ORDER BY added_at DESC, resolved_at DESC",
);
const upsertAgent = db.prepare(`
	INSERT INTO agents (id, url, did, agent_card, resolved_at, source, added_at)
	VALUES (@id, @url, @did, @agentCard, @resolvedAt, @source, @addedAt)
	ON CONFLICT(id) DO UPDATE SET
		url = COALESCE(excluded.url, agents.url),
		did = COALESCE(excluded.did, agents.did),
		agent_card = COALESCE(excluded.agent_card, agents.agent_card),
		resolved_at = excluded.resolved_at,
		source = CASE WHEN agents.source = 'manual' THEN 'manual' ELSE excluded.source END
`);

const MAX_EVENTS = 1000;

export function recordEvent(
	id: string,
	agentId: string,
	receivedAt: string,
	payload: Record<string, unknown>,
): boolean {
	const contextId =
		typeof payload.context_id === "string" ? (payload.context_id as string) : null;
	let firstContact = false;
	if (contextId) {
		const result = upsertContext.run(agentId, contextId, receivedAt);
		firstContact = result.changes > 0;
	}
	insertEvent.run(id, agentId, receivedAt, JSON.stringify(payload), firstContact ? 1 : 0);
	trimEvents.run(MAX_EVENTS);
	return firstContact;
}

export function listRecentEvents(limit = 50): EventRow[] {
	type Row = {
		id: string;
		agentId: string;
		receivedAt: string;
		payload: string;
		firstContact: number;
	};
	const rows = recentEvents.all(limit) as Row[];
	return rows.map((r) => ({
		id: r.id,
		agentId: r.agentId,
		receivedAt: r.receivedAt,
		payload: JSON.parse(r.payload) as Record<string, unknown>,
		firstContact: !!r.firstContact,
	}));
}

export function listAgents(): string[] {
	type Row = { agentId: string };
	return (distinctAgents.all() as Row[]).map((r) => r.agentId);
}

export interface AgentRecord {
	id: string;
	url?: string;
	did?: unknown;
	agentCard?: unknown;
	resolvedAt?: string;
	source?: "webhook" | "manual";
	addedAt?: string;
}

type AgentRow = {
	id: string;
	url: string | null;
	did: string | null;
	agentCard: string | null;
	resolvedAt: string | null;
	source: string | null;
	addedAt: string | null;
};

function rowToRecord(row: AgentRow): AgentRecord {
	return {
		id: row.id,
		url: row.url ?? undefined,
		did: row.did ? JSON.parse(row.did) : null,
		agentCard: row.agentCard ? JSON.parse(row.agentCard) : null,
		resolvedAt: row.resolvedAt ?? undefined,
		source: (row.source as "webhook" | "manual") ?? "webhook",
		addedAt: row.addedAt ?? undefined,
	};
}

export function readAgent(id: string): AgentRecord | null {
	const row = getAgent.get(id) as AgentRow | undefined;
	return row ? rowToRecord(row) : null;
}

export function listEcosystem(): AgentRecord[] {
	return (listAllAgents.all() as AgentRow[]).map(rowToRecord);
}

export function writeAgent(rec: AgentRecord): void {
	upsertAgent.run({
		id: rec.id,
		url: rec.url ?? null,
		did: rec.did === undefined ? null : JSON.stringify(rec.did),
		agentCard:
			rec.agentCard === undefined ? null : JSON.stringify(rec.agentCard),
		resolvedAt: rec.resolvedAt ?? null,
		source: rec.source ?? "webhook",
		addedAt: rec.addedAt ?? null,
	});
}

// --- thread state (read / unread / archive) -----------------------------
// Source of truth for operator triage state, replacing the previous
// localStorage-only model. Stored per-thread (context_id), independent of
// any agentId — a thread's read/archive state spans lanes.

const stateUpdate = db.prepare(`
	INSERT INTO thread_state (context_id, read_at, unread_at, archived_at)
	VALUES (@contextId, @readAt, @unreadAt, @archivedAt)
	ON CONFLICT(context_id) DO UPDATE SET
		read_at      = COALESCE(@readAt, thread_state.read_at),
		unread_at    = COALESCE(@unreadAt, thread_state.unread_at),
		archived_at  = COALESCE(@archivedAt, thread_state.archived_at)
`);

const stateClear = db.prepare(`
	UPDATE thread_state SET
		read_at      = CASE WHEN @clearRead     = 1 THEN NULL ELSE read_at END,
		unread_at    = CASE WHEN @clearUnread   = 1 THEN NULL ELSE unread_at END,
		archived_at  = CASE WHEN @clearArchived = 1 THEN NULL ELSE archived_at END
	WHERE context_id = @contextId
`);

const stateList = db.prepare(
	"SELECT context_id AS contextId, read_at AS readAt, unread_at AS unreadAt, archived_at AS archivedAt FROM thread_state",
);

export interface ThreadStateRow {
	contextId: string;
	readAt: string | null;
	unreadAt: string | null;
	archivedAt: string | null;
}

export function markThreadRead(contextId: string): void {
	const now = new Date().toISOString();
	stateUpdate.run({ contextId, readAt: now, unreadAt: null, archivedAt: null });
	// Clearing unread_at must be explicit because the upsert above only ever
	// COALESCEs new values in.
	stateClear.run({ contextId, clearRead: 0, clearUnread: 1, clearArchived: 0 });
}

export function markThreadUnread(contextId: string): void {
	const now = new Date().toISOString();
	stateUpdate.run({ contextId, readAt: null, unreadAt: now, archivedAt: null });
	stateClear.run({ contextId, clearRead: 1, clearUnread: 0, clearArchived: 0 });
}

export function archiveThread(contextId: string): void {
	const now = new Date().toISOString();
	stateUpdate.run({ contextId, readAt: null, unreadAt: null, archivedAt: now });
}

export function unarchiveThread(contextId: string): void {
	stateUpdate.run({
		contextId,
		readAt: null,
		unreadAt: null,
		archivedAt: null,
	});
	stateClear.run({ contextId, clearRead: 0, clearUnread: 0, clearArchived: 1 });
}

export function listThreadState(): ThreadStateRow[] {
	return stateList.all() as ThreadStateRow[];
}
