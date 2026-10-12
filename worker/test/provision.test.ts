// worker/test/provision.test.ts
import { describe, it, expect, vi } from "vitest";
import { agentBody, searchToolBody, LIVE_INSTRUCTIONS, AGENT_NAME, SEARCH_TOOL_NAME } from "../src/prompts/live";
import { provisionAgent, type ElApi } from "../src/provision";

describe("agent config", () => {
  it("builds the tool body per spec", () => {
    const t = searchToolBody() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(t.tool_config).toMatchObject({ type: "client", name: SEARCH_TOOL_NAME, expects_response: true, response_timeout_secs: 10 });
    expect(t.tool_config.parameters).toEqual({ type: "object", properties: { query: { type: "string", description: "Key words or a short question to search for" } }, required: ["query"] });
  });
  it("builds the agent body per spec", () => {
    const a = agentBody("tool_1", ["pdfstudio.shemaiah7.workers.dev", "localhost"], true) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(a.name).toBe(AGENT_NAME);
    expect(a.conversation_config.agent.prompt).toMatchObject({ prompt: LIVE_INSTRUCTIONS, llm: "claude-sonnet-5-5", temperature: 0, tool_ids: ["tool_1"] });
    expect(a.conversation_config.agent.first_message).toBe("Ready. Ask me about the open document.");
    expect(a.conversation_config.tts).toEqual({ model_id: "eleven_v4_turbo", voice_id: "cjVigY5qzO86Huf0OWal" });
    expect(a.conversation_config.turn).toEqual({ turn_timeout: 7, turn_eagerness: "normal" });
    expect(a.conversation_config.conversation).toEqual({ max_duration_seconds: 600, client_events: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "client_tool_call"] });
    expect(a.platform_settings.auth).toEqual({ enable_auth: true, allowlist: [{ hostname: "pdfstudio.shemaiah7.workers.dev" }, { hostname: "localhost" }] });
    expect(a.platform_settings.privacy).toEqual({ record_voice: false, retention_days: 0, delete_transcript_and_pii: true, delete_audio: true, zero_retention_mode: true, apply_to_existing_conversations: true });
    expect((agentBody("t", [], false) as any).platform_settings.privacy.zero_retention_mode).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it("instructions mention the tool and the hands-free constraints", () => {
    expect(LIVE_INSTRUCTIONS).toContain("search_document");
    expect(LIVE_INSTRUCTIONS).toContain("two or three sentences");
  });
});

function fakeApi(opts: { tools?: any[]; agents?: any[]; rejectZero?: boolean } = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const api: ElApi = {
    async get(path) { calls.push({ m: "GET", path });
      if (path.startsWith("/v1/convai/tools")) return { status: 200, body: { tools: opts.tools ?? [] } };
      if (path.startsWith("/v1/convai/agents/")) return { status: 200, body: { agent_id: path.split("/").pop(), platform_settings: { privacy: { zero_retention_mode: !opts.rejectZero } } } };
      if (path.startsWith("/v1/convai/agents")) return { status: 200, body: { agents: opts.agents ?? [] } };
      return { status: 404, body: {} }; },
    async post(path, body) { calls.push({ m: "POST", path, body });
      if (path === "/v1/convai/tools") return { status: 200, body: { id: "tool_new" } };
      if (path === "/v1/convai/agents/create") { if (opts.rejectZero && (body as any).platform_settings.privacy.zero_retention_mode) return { status: 422, body: {} }; return { status: 200, body: { agent_id: "agent_new" } }; } // eslint-disable-line @typescript-eslint/no-explicit-any
      return { status: 404, body: {} }; },
    async patch(path, body) { calls.push({ m: "PATCH", path, body });
      if (opts.rejectZero && (body as any)?.platform_settings?.privacy?.zero_retention_mode) return { status: 422, body: {} }; // eslint-disable-line @typescript-eslint/no-explicit-any
      return { status: 200, body: {} }; },
  };
  return { api, calls };
}

describe("provisionAgent", () => {
  it("creates the tool and the agent when neither exists", async () => {
    const { api, calls } = fakeApi();
    const r = await provisionAgent(api, ["localhost"]);
    expect(r).toMatchObject({ agentId: "agent_new", toolId: "tool_new", zeroRetention: true });
    expect(calls.map((c) => `${c.m} ${c.path}`)).toEqual(["GET /v1/convai/tools", "POST /v1/convai/tools", "GET /v1/convai/agents?page_size=100", "POST /v1/convai/agents/create", "GET /v1/convai/agents/agent_new"]);
  });
  it("patches existing tool and agent found by name", async () => {
    const { api, calls } = fakeApi({ tools: [{ id: "tool_old", tool_config: { name: "search_document" } }], agents: [{ agent_id: "agent_old", name: "PDF Studio Voice" }] });
    const r = await provisionAgent(api, ["localhost"]);
    expect(r).toMatchObject({ agentId: "agent_old", toolId: "tool_old" });
    expect(calls.map((c) => `${c.m} ${c.path}`)).toContain("PATCH /v1/convai/tools/tool_old");
    expect(calls.map((c) => `${c.m} ${c.path}`)).toContain("PATCH /v1/convai/agents/agent_old");
  });
  it("retries without zero_retention_mode when the API rejects it", async () => {
    const { api, calls } = fakeApi({ rejectZero: true });
    const r = await provisionAgent(api, ["localhost"]);
    expect(r.zeroRetention).toBe(false);
    const creates = calls.filter((c) => c.path === "/v1/convai/agents/create");
    expect(creates).toHaveLength(2);
    expect((creates[1].body as any).platform_settings.privacy.zero_retention_mode).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe("provisionAgent failure modes", () => {
  const wrap = (api: ElApi, o: Partial<ElApi>): ElApi => ({ ...api, ...o });
  it("rejects on a list 5xx without creating anything", async () => {
    const { api, calls } = fakeApi();
    const bad = wrap(api, { get: async (p) => { calls.push({ m: "GET", path: p }); return { status: 503, body: {} }; } });
    await expect(provisionAgent(bad, ["localhost"])).rejects.toThrow(/list failed: 503/);
    expect(calls.some((c) => c.m === "POST")).toBe(false);
  });
  it("rejects when the agent list page is full with no match", async () => {
    const agents = Array.from({ length: 100 }, (_, i) => ({ agent_id: `a${i}`, name: `other${i}` }));
    const { api } = fakeApi({ agents });
    await expect(provisionAgent(api, ["localhost"])).rejects.toThrow(/list page full/);
  });
  it("rejects when two agents share the name", async () => {
    const { api } = fakeApi({ agents: [{ agent_id: "a1", name: "PDF Studio Voice" }, { agent_id: "a2", name: "PDF Studio Voice" }] });
    await expect(provisionAgent(api, ["localhost"])).rejects.toThrow(/multiple agents/);
  });
  it("does not fall back on 403", async () => {
    const { api, calls } = fakeApi();
    const bad = wrap(api, { post: async (p, b) => { if (p === "/v1/convai/agents/create") { calls.push({ m: "POST", path: p, body: b }); return { status: 403, body: {} }; } return api.post(p, b); } });
    await expect(provisionAgent(bad, ["localhost"])).rejects.toThrow(/403/);
    expect(calls.filter((c) => c.path === "/v1/convai/agents/create")).toHaveLength(1);
  });
  it("warns when falling back on 422", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api } = fakeApi({ rejectZero: true });
    await provisionAgent(api, ["localhost"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("zero_retention_mode rejected"));
    warn.mockRestore();
  });
  it("rejects when create returns no agent_id", async () => {
    const { api } = fakeApi();
    const bad = wrap(api, { post: async (p, b) => (p === "/v1/convai/agents/create" ? { status: 200, body: {} } : api.post(p, b)) });
    await expect(provisionAgent(bad, ["localhost"])).rejects.toThrow(/no id/);
  });
});
