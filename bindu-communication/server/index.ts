import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
	type AgentRecord,
	type EventRow,
	listAgents,
	listRecentEvents,
	readAgent,
	recordEvent,
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

async function resolveAgent(agentId: string): Promise<AgentRecord> {
	const cached = readAgent(agentId);
	if (cached?.did && cached?.agentCard) return cached;
	const base = AGENT_URLS[agentId];
	const rec: AgentRecord = cached ?? { id: agentId, url: base };
	if (!base) {
		writeAgent(rec);
		return rec;
	}
	try {
		const [didR, cardR] = await Promise.all([
			fetch(`${base}/.well-known/did.json`).then((r) => (r.ok ? r.json() : null)),
			fetch(`${base}/.well-known/agent.json`).then((r) => (r.ok ? r.json() : null)),
		]);
		rec.did = didR;
		rec.agentCard = cardR;
		rec.url = base;
		rec.resolvedAt = new Date().toISOString();
	} catch (err) {
		console.warn(`[resolve] ${agentId} failed:`, (err as Error).message);
	}
	writeAgent(rec);
	return rec;
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
