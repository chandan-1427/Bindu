/** Client-side mirror of an agent record returned by /api/ecosystem and
 * /api/agents/:id. Kept structurally permissive — the server is the
 * source of truth (see `server/db.ts:AgentRecord`), and the UI only
 * reads a subset of each field. */
export interface EcosystemAgent {
	id: string;
	url?: string;
	did?: {
		id?: string;
		verificationMethod?: Array<Record<string, unknown>>;
	} | null;
	agentCard?: {
		name?: string;
		capabilities?: unknown;
		skills?: unknown;
	} | null;
	resolvedAt?: string;
	source?: "webhook" | "manual";
}
