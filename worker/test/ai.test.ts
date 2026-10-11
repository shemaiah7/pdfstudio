import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { aiHandler } from "../src/handlers/ai";
import type { StreamFn } from "../src/claude";
import { signSession } from "../src/session";
import { recordUsage, DAILY_REQUESTS } from "../src/quota";

const fakeStream =
  (chunks: string[], stop = "end_turn", usage = { inputTokens: 1000, outputTokens: 50 }): StreamFn =>
  async () => ({
    events: (async function* () { for (const c of chunks) yield { type: "text" as const, text: c }; })(),
    final: async () => ({ ...usage, stop }),
  });

async function post(body: unknown, token?: string, stream: StreamFn = fakeStream(["Hel", "lo"]), extraHeaders: Record<string, string> = {}) {
  const req = new Request("https://ai.example/ai", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await aiHandler(req, env, ctx, stream);
  const text = res.body ? await new Response(res.body).text() : "";
  await waitOnExecutionContext(ctx);
  return { res, text };
}

const token = () => signSession({ vid: "vid-a", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
const doc = { task: "summarize", document: [{ page: 1, text: "hi" }] };

describe("POST /ai", () => {
  it("401 without a valid session", async () => {
    expect((await post(doc)).res.status).toBe(401);
    expect((await post(doc, "bad.token")).res.status).toBe(401);
  });

  it("400 on invalid body", async () => {
    const { res } = await post({ task: "nope" }, await token());
    expect(res.status).toBe(400);
  });

  it("413 when content-length exceeds the raw body cap", async () => {
    const { res, text } = await post(doc, await token(), fakeStream(["x"]), { "content-length": "1000001" });
    expect(res.status).toBe(413);
    expect(JSON.parse(text)).toEqual({ error: "document_too_large", maxChars: 600000 });
  });

  it("streams deltas and done, then records usage", async () => {
    const { res, text } = await post(doc, await token());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(text).toContain('event: delta\ndata: {"text":"Hel"}');
    expect(text).toContain('event: delta\ndata: {"text":"lo"}');
    expect(text).toMatch(/event: done\ndata: \{"usage":\{"input":1000,"output":50\},"stop":"end_turn","remaining":\{"requests":19,"tokens":198950\},"resetAt":\d+\}/);
    const state = await env.QUOTA.get(`q:vid-a:${new Date().toISOString().slice(0, 10)}`, "json");
    expect(state).toEqual({ requests: 1, tokens: 1050 });
  });

  it("429 when the daily quota is used up", async () => {
    const t = await signSession({ vid: "vid-full", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
    const day = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < DAILY_REQUESTS; i++) await recordUsage(env.QUOTA, "vid-full", day, 1);
    const { res, text } = await post(doc, t);
    expect(res.status).toBe(429);
    expect(JSON.parse(text)).toMatchObject({ error: "daily_limit" });
  });

  it("emits error: refused when the stream stops with refusal", async () => {
    const { text } = await post(doc, await token(), fakeStream([], "refusal"));
    expect(text).toContain('event: error\ndata: {"error":"refused"}');
  });

  it("emits error: busy when the upstream throws a rate limit", async () => {
    const busy: StreamFn = async () => { const e = new Error("rl"); (e as Error & { status: number }).status = 429; throw e; };
    const { res, text } = await post(doc, await token(), busy);
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: "busy" });
  });

  it("emits error: upstream if the stream fails mid-way", async () => {
    const failing: StreamFn = async () => ({
      events: (async function* () { yield { type: "text" as const, text: "a" }; throw new Error("boom"); })(),
      final: async () => ({ inputTokens: 0, outputTokens: 0, stop: "end_turn" }),
    });
    const { text } = await post(doc, await token(), failing);
    expect(text).toContain('event: delta\ndata: {"text":"a"}');
    expect(text).toContain('event: error\ndata: {"error":"upstream"}');
  });
});
