// worker/src/provision.ts
import { AGENT_NAME, SEARCH_TOOL_NAME, agentBody, searchToolBody } from "./prompts/live";

export interface ElApi {
  get(path: string): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  post(path: string, body: unknown): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  patch(path: string, body: unknown): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const ok = (r: { status: number }) => r.status >= 200 && r.status < 300;

const PAGE = 100;

function findUnique<T>(items: T[], match: (x: T) => boolean, what: string, name: string): T | undefined {
  const hits = items.filter(match);
  if (hits.length > 1) throw new Error(`multiple ${what}s named ${name}; delete the extras in the ElevenLabs dashboard`);
  if (hits.length === 0 && items.length >= PAGE) throw new Error(`${what} list page full; widen the lookup`);
  return hits[0];
}

async function upsertTool(api: ElApi): Promise<string> {
  const list = await api.get("/v1/convai/tools");
  if (!ok(list)) throw new Error(`tool list failed: ${list.status}`);
  const tools = (list.body?.tools ?? []) as { id: string; tool_config?: { name?: string } }[];
  const existing = findUnique(tools, (t) => t.tool_config?.name === SEARCH_TOOL_NAME, "tool", SEARCH_TOOL_NAME);
  if (existing) {
    const r = await api.patch(`/v1/convai/tools/${existing.id}`, searchToolBody());
    if (!ok(r)) throw new Error(`tool patch failed: ${r.status}`);
    return existing.id;
  }
  const r = await api.post("/v1/convai/tools", searchToolBody());
  if (!ok(r) || typeof r.body?.id !== "string") throw new Error(`tool create failed: ${r.status}`);
  return r.body.id;
}

async function upsertAgent(api: ElApi, toolId: string, hostnames: string[]): Promise<{ agentId: string; zeroRetention: boolean }> {
  const list = await api.get("/v1/convai/agents?page_size=100");
  if (!ok(list)) throw new Error(`agent list failed: ${list.status}`);
  const agents = (list.body?.agents ?? []) as { agent_id: string; name?: string }[];
  const existing = findUnique(agents, (a) => a.name === AGENT_NAME, "agent", AGENT_NAME);
  for (const zero of [true, false]) {
    const body = agentBody(toolId, hostnames, zero);
    const r = existing ? await api.patch(`/v1/convai/agents/${existing.agent_id}`, body) : await api.post("/v1/convai/agents/create", body);
    if (ok(r)) {
      if (existing) return { agentId: existing.agent_id, zeroRetention: zero };
      if (typeof r.body?.agent_id !== "string") throw new Error("agent create returned no id");
      return { agentId: r.body.agent_id, zeroRetention: zero };
    }
    if (r.status !== 422) throw new Error(`agent ${existing ? "patch" : "create"} failed: ${r.status}`);
    if (zero) console.warn("WARNING: zero_retention_mode rejected by the API; retrying without it — transcripts rely on retention_days 0 deletion");
  }
  throw new Error("agent create/patch rejected even without zero_retention_mode");
}

/** Creates or updates the search tool and the agent from the versioned config; returns what the API accepted. */
export async function provisionAgent(api: ElApi, hostnames: string[]): Promise<{ agentId: string; toolId: string; zeroRetention: boolean; privacy: unknown }> {
  const toolId = await upsertTool(api);
  const { agentId, zeroRetention } = await upsertAgent(api, toolId, hostnames);
  const check = await api.get(`/v1/convai/agents/${agentId}`);
  return { agentId, toolId, zeroRetention, privacy: check.body?.platform_settings?.privacy ?? null };
}
