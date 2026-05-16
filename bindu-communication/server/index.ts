import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
	type AgentRecord,
	type EventRow,
	archiveThread,
	listAgents,
	listEcosystem,
	listRecentEvents,
	listThreadState,
	markThreadRead,
	markThreadUnread,
	readAgent,
	recordEvent,
	unarchiveThread,
	writeAgent,
} from "./db";

// agentId → base URL for callbacks. Defaults cover the dev fleet; override
// or extend via BINDU_AGENT_URLS env var, comma-separated `id=url` pairs:
//   BINDU_AGENT_URLS="agno-simple=http://10.0.0.5:3773,my-agent=http://x:9000"
// Anything in the env var wins over the defaults. Real production should
// learn this from a signed payload field on the webhook itself; that's a
// follow-up that requires a Bindu core change.
const AGENT_URL_DEFAULTS: Record<string, string> = {
	"agno-simple": "http://127.0.0.1:3773",
	"agno-paywall": "http://127.0.0.1:3775",
	gateway: "http://127.0.0.1:3774",
};

function parseAgentUrls(): Record<string, string> {
	const out: Record<string, string> = { ...AGENT_URL_DEFAULTS };
	const raw = process.env.BINDU_AGENT_URLS;
	if (!raw) return out;
	for (const pair of raw.split(",")) {
		const eq = pair.indexOf("=");
		if (eq <= 0) continue;
		const id = pair.slice(0, eq).trim();
		const url = pair.slice(eq + 1).trim();
		if (id && url) out[id] = url;
	}
	return out;
}

const AGENT_URLS = parseAgentUrls();

const subscribers = new Set<(e: EventRow) => void>();

// Optional dev-time bearer token gate. When BINDU_COMMS_TOKEN is set, /api/*
// requires Authorization: Bearer <token> (or ?token=<token> for SSE, since
// browser EventSource can't set headers).
const REQUIRED_TOKEN = process.env.BINDU_COMMS_TOKEN ?? "";

// Optional webhook auth. When BINDU_WEBHOOK_TOKEN is set, agents must
// include `Authorization: Bearer <token>` on every webhook POST — which is
// what the Bindu agent does when global_webhook_token is configured (see
// bindu/utils/notifications.py:_build_headers). Mismatched / missing →
// 401. When unset, webhooks stay open (current dev behavior).
const WEBHOOK_TOKEN = process.env.BINDU_WEBHOOK_TOKEN ?? "";

// Webhook agentId comes off the URL path, so we constrain the shape to
// rule out traversal-style inputs and pathological lengths.
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function authMiddleware(c: {
	req: {
		header: (name: string) => string | undefined;
		query: (name: string) => string | undefined;
	};
}) {
	if (!REQUIRED_TOKEN) return null;
	const header = c.req.header("authorization") ?? "";
	if (header === `Bearer ${REQUIRED_TOKEN}`) return null;
	const query = c.req.query("token") ?? "";
	if (query === REQUIRED_TOKEN) return null;
	return { error: "unauthorized" } as const;
}

async function fetchWellKnown(base: string) {
	const [didR, cardR] = await Promise.all([
		fetch(`${base}/.well-known/did.json`).then((r) => (r.ok ? r.json() : null)),
		fetch(`${base}/.well-known/agent.json`).then((r) => (r.ok ? r.json() : null)),
	]);
	return { did: didR as unknown, agentCard: cardR as unknown };
}

async function resolveAgent(agentId: string): Promise<AgentRecord> {
	const cached = readAgent(agentId);
	if (cached?.did && cached?.agentCard) return cached;
	const base = cached?.url ?? AGENT_URLS[agentId];
	const rec: AgentRecord = cached ?? { id: agentId, url: base, source: "webhook" };
	if (!base) {
		writeAgent(rec);
		return rec;
	}
	try {
		const { did, agentCard } = await fetchWellKnown(base);
		rec.did = did;
		rec.agentCard = agentCard;
		rec.url = base;
		rec.resolvedAt = new Date().toISOString();
	} catch (err) {
		console.warn(`[resolve] ${agentId} failed:`, (err as Error).message);
	}
	writeAgent(rec);
	return rec;
}

function slugify(s: string): string {
	const cleaned = s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
	return cleaned || `agent-${Math.random().toString(36).slice(2, 6)}`;
}

const app = new Hono();

app.post("/webhooks/bindu/:agentId", async (c) => {
	if (WEBHOOK_TOKEN) {
		const header = c.req.header("authorization") ?? "";
		if (header !== `Bearer ${WEBHOOK_TOKEN}`) {
			return c.json({ error: "unauthorized" }, 401);
		}
	}
	const agentId = c.req.param("agentId");
	if (!AGENT_ID_RE.test(agentId)) {
		return c.json({ error: "invalid-agent-id" }, 400);
	}
	const payload = (await c.req.json()) as Record<string, unknown>;
	const id = String(payload.event_id ?? crypto.randomUUID());
	const receivedAt = new Date().toISOString();
	const firstContact = recordEvent(id, agentId, receivedAt, payload);
	const ev: EventRow = { id, agentId, receivedAt, payload, firstContact };
	for (const cb of subscribers) cb(ev);
	console.log(
		`[webhook] ${agentId} ${payload.kind ?? "?"} ${payload.task_id ?? ""}${firstContact ? " (first-contact)" : ""}`,
	);
	const seen = readAgent(agentId);
	if (!seen) {
		writeAgent({
			id: agentId,
			url: AGENT_URLS[agentId],
			source: "webhook",
			addedAt: new Date().toISOString(),
		});
	}
	if (!seen?.agentCard) {
		resolveAgent(agentId).catch(() => {});
	}
	return c.json({ ok: true });
});

app.get("/api/events/stream", (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	const agentFilter = c.req.query("agentId");
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const send = (e: EventRow) => {
				if (agentFilter && e.agentId !== agentFilter) return;
				controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
			};
			for (const e of listRecentEvents(50)) send(e);
			subscribers.add(send);
			c.req.raw.signal.addEventListener("abort", () => {
				subscribers.delete(send);
				controller.close();
			});
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		},
	});
});

app.get("/api/agents", (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	return c.json(listAgents());
});

app.get("/api/agents/:agentId", async (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	const rec = await resolveAgent(c.req.param("agentId"));
	return c.json(rec);
});

// Ecosystem — every known agent (webhook-seen + manually added). The Gmail-
// shaped inbox uses this list as the "Contacts / Senders" surface. POST
// here to add a third-party agent by URL; the server fetches its well-known
// docs and stores a slugified record.
app.get("/api/ecosystem", (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	return c.json(listEcosystem());
});

app.post("/api/ecosystem", async (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	const body = (await c.req.json().catch(() => ({}))) as {
		url?: string;
		id?: string;
	};
	const url = (body.url ?? "").replace(/\/+$/, "");
	if (!/^https?:\/\//.test(url)) {
		return c.json({ error: "invalid-url" }, 400);
	}
	let did: unknown = null;
	let agentCard: unknown = null;
	try {
		const r = await fetchWellKnown(url);
		did = r.did;
		agentCard = r.agentCard;
	} catch (err) {
		return c.json({ error: "fetch-failed", detail: (err as Error).message }, 502);
	}
	const cardObj = (agentCard ?? {}) as Record<string, unknown>;
	const name =
		typeof cardObj.name === "string" && cardObj.name.length > 0
			? (cardObj.name as string)
			: typeof cardObj.id === "string"
				? (cardObj.id as string)
				: "agent";
	const id = body.id && AGENT_ID_RE.test(body.id) ? body.id : slugify(name);
	if (!AGENT_ID_RE.test(id)) {
		return c.json({ error: "could-not-derive-id" }, 400);
	}
	const now = new Date().toISOString();
	const rec: AgentRecord = {
		id,
		url,
		did,
		agentCard,
		resolvedAt: now,
		source: "manual",
		addedAt: now,
	};
	writeAgent(rec);
	if (!(id in AGENT_URLS)) AGENT_URLS[id] = url;
	return c.json(rec, 201);
});

// Thread state — operator-side triage flags (read / unread / archived)
// keyed by context_id. Source of truth lives in SQLite; the frontend's
// localStorage caches are gone in favor of this.
app.get("/api/threads/state", (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	return c.json(listThreadState());
});

app.post("/api/threads/:contextId/:action", async (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	const contextId = c.req.param("contextId");
	const action = c.req.param("action");
	if (!contextId) return c.json({ error: "missing-context" }, 400);
	switch (action) {
		case "read":
			markThreadRead(contextId);
			break;
		case "unread":
			markThreadUnread(contextId);
			break;
		case "archive":
			archiveThread(contextId);
			break;
		case "unarchive":
			unarchiveThread(contextId);
			break;
		default:
			return c.json({ error: "unknown-action" }, 400);
	}
	return c.json({ ok: true });
});

// Step 2: compose. Operator sends an outbound `message/send` to a known
// agent. We record it locally under agentId="outbox" so the new thread
// shows up immediately in the inbox UI (the recipient's lifecycle
// webhooks, if it's configured to push back to us, will arrive later
// against its own agentId, so they appear as a separate thread on that
// agent's lane — that's a known dev-surface duality we'll fix when we
// teach comms to correlate outbound→inbound by context_id across agents).
const OUTBOX_AGENT_ID = "outbox";
const OPERATOR_DID =
	process.env.BINDU_COMMS_OPERATOR_DID ?? "did:bindu:operator:local";

app.post("/api/compose", async (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	const body = (await c.req.json().catch(() => ({}))) as {
		agentId?: string;
		text?: string;
		contextId?: string;
	};
	const targetId = (body.agentId ?? "").trim();
	const text = (body.text ?? "").trim();
	if (!targetId || !AGENT_ID_RE.test(targetId)) {
		return c.json({ error: "invalid-agent-id" }, 400);
	}
	if (!text) {
		return c.json({ error: "empty-text" }, 400);
	}
	const target = readAgent(targetId);
	const base = target?.url ?? AGENT_URLS[targetId];
	if (!base) {
		return c.json({ error: "unknown-agent", detail: targetId }, 404);
	}

	const contextId = body.contextId ?? crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const messageId = crypto.randomUUID();

	const rpc = {
		jsonrpc: "2.0",
		id: crypto.randomUUID(),
		method: "message/send",
		params: {
			message: {
				role: "user",
				kind: "message",
				parts: [{ kind: "text", text }],
				messageId,
				contextId,
				taskId,
				metadata: { from_did: OPERATOR_DID },
			},
			configuration: { acceptedOutputModes: ["application/json"] },
		},
	};

	let upstreamStatus = 0;
	let upstreamBody: unknown = null;
	let upstreamError: string | null = null;
	try {
		const r = await fetch(base, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(rpc),
		});
		upstreamStatus = r.status;
		upstreamBody = await r.json().catch(() => null);
	} catch (err) {
		upstreamError = (err as Error).message;
	}

	const now = new Date().toISOString();
	const outboundEvent = {
		event_id: crypto.randomUUID(),
		timestamp: now,
		kind: "outbound",
		direction: "out",
		from_did: OPERATOR_DID,
		to_agent_id: targetId,
		to_did: target?.did
			? (target.did as { id?: string }).id ?? null
			: null,
		context_id: contextId,
		task_id: taskId,
		message_id: messageId,
		text,
		upstream_status: upstreamStatus,
		upstream_error: upstreamError,
	} as Record<string, unknown>;

	const recordedId = String(outboundEvent.event_id);
	recordEvent(recordedId, OUTBOX_AGENT_ID, now, outboundEvent);
	for (const cb of subscribers) {
		cb({
			id: recordedId,
			agentId: OUTBOX_AGENT_ID,
			receivedAt: now,
			payload: outboundEvent,
			firstContact: true,
		});
	}
	if (!readAgent(OUTBOX_AGENT_ID)) {
		writeAgent({
			id: OUTBOX_AGENT_ID,
			source: "webhook",
			addedAt: now,
		});
	}

	if (upstreamError) {
		return c.json(
			{ ok: false, error: "send-failed", detail: upstreamError, contextId, taskId },
			502,
		);
	}
	return c.json({
		ok: upstreamStatus >= 200 && upstreamStatus < 300,
		status: upstreamStatus,
		contextId,
		taskId,
		response: upstreamBody,
	});
});

// Phase 5: action callbacks. Looks up the source agent, sends a follow-up
// JSON-RPC message on the same context/task. Only `input` is meaningful end-
// to-end today; `approve`/`pay`/`decline` are recorded but not yet wired to
// the underlying protocol moves (we say so honestly in the response).
app.post("/api/events/:id/action", async (c) => {
	const blocked = authMiddleware(c);
	if (blocked) return c.json(blocked, 401);
	const evId = c.req.param("id");
	// Look up the event in the recent buffer. We don't load every historical
	// row — the action UI only lives on events you can still see.
	const ev = listRecentEvents(1000).find((e) => e.id === evId);
	if (!ev) return c.json({ error: "event-not-found" }, 404);
	const body = (await c.req.json().catch(() => ({}))) as {
		kind?: "approve" | "decline" | "input" | "pay";
		text?: string;
	};
	const kind = body.kind ?? "approve";
	const base = AGENT_URLS[ev.agentId];
	const taskId = ev.payload.task_id as string | undefined;
	const contextId = ev.payload.context_id as string | undefined;
	console.log(`[action] ${kind} on ${evId} (agent=${ev.agentId} task=${taskId})`);

	if (kind === "input" && base && taskId && contextId) {
		const msg = {
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "message/send",
			params: {
				message: {
					role: "user",
					kind: "message",
					parts: [{ kind: "text", text: body.text ?? "(continue)" }],
					messageId: crypto.randomUUID(),
					contextId,
					taskId,
				},
				configuration: { acceptedOutputModes: ["application/json"] },
			},
		};
		try {
			const r = await fetch(base, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(msg),
			});
			return c.json({ ok: r.ok, status: r.status, delivered: r.ok });
		} catch (err) {
			return c.json({ ok: false, error: (err as Error).message }, 502);
		}
	}
	return c.json({
		ok: true,
		kind,
		recorded: true,
		protocolMovePending: true,
	});
});

serve({ fetch: app.fetch, port: 3787 }, (info) => {
	console.log(`[bindu-communication] api on http://127.0.0.1:${info.port}`);
	if (REQUIRED_TOKEN) {
		console.log(`[bindu-communication] /api/* requires Bearer token`);
	}
	if (WEBHOOK_TOKEN) {
		console.log(`[bindu-communication] webhooks require Bearer token`);
	}
});
