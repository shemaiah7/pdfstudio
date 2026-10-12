// worker/src/provision.ts
import { AGENT_NAME, SEARCH_TOOL_NAME, agentBody, searchToolBody } from "./prompts/live";

export interface ElApi {
  get(path: string): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  post(path: string, body: unknown): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  patch(path: string, body: unknown): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const ok = (r: { status: number }) => r.status >= 200 && r.status < 300;

async function upsertTool(api: ElApi): Promise<string> {
  const list = await api.get("/v1/convai/tools");
  const existing = ok(list) ? (list.body?.tools as { id: string; tool_config?: { name?: string } }[] | undefined)?.find((t) => t.tool_config?.name === SEARCH_TOOL_NAME) : undefined;
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
  const existing = ok(list) ? (list.body?.agents as { agent_id: string; name?: string }[] | undefined)?.find((a) => a.name === AGENT_NAME) : undefined;
  for (const zero of [true, false]) {
    const body = agentBody(toolId, hostnames, zero);
    const r = existing ? await api.patch(`/v1/convai/agents/${existing.agent_id}`, body) : await api.post("/v1/convai/agents/create", body);
    if (ok(r)) return { agentId: existing ? existing.agent_id : String(r.body?.agent_id), zeroRetention: zero };
    if (r.status !== 422 && r.status !== 400 && r.status !== 403) throw new Error(`agent ${existing ? "patch" : "create"} failed: ${r.status}`);
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
