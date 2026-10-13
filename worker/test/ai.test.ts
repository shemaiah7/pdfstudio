import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { aiHandler } from "../src/handlers/ai";
import type { StreamFn } from "../src/claude";
import { signSession } from "../src/session";
import { DAILY_REQUESTS } from "../src/quota";

const fakeStream =
  (chunks: string[], stop = "end_turn", usage = { inputTokens: 1000, outputTokens: 50 }): StreamFn =>
  async () => ({
    events: (async function* () { for (const c of chunks) yield { type: "text" as const, text: c }; })(),
    final: async () => ({ ...usage, stop }),
    usageSoFar: () => usage,
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
    const { res, text } = await post(doc, await token(), fakeStream(["x"]), { "content-length": "2500001" });
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
    await env.QUOTA.put(`q:vid-full:${day}`, JSON.stringify({ requests: DAILY_REQUESTS, tokens: 1 }));
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
      usageSoFar: () => ({ inputTokens: 0, outputTokens: 0 }),
    });
    const { text } = await post(doc, await token(), failing);
    expect(text).toContain('event: delta\ndata: {"text":"a"}');
    expect(text).toContain('event: error\ndata: {"error":"upstream"}');
  });

  it("emits error: busy when the upstream throws 529 mid-stream", async () => {
    const mid: StreamFn = async () => ({
      events: (async function* () { throw Object.assign(new Error("overloaded"), { status: 529 }); yield { type: "text" as const, text: "" }; })(),
      final: async () => ({ inputTokens: 0, outputTokens: 0, stop: "end_turn" }),
      usageSoFar: () => ({ inputTokens: 0, outputTokens: 0 }),
    });
    const { res, text } = await post(doc, await token(), mid);
    expect(res.status).toBe(200);
    expect(text).toContain('event: error\ndata: {"error":"busy"}');
  });

  it("emits error: busy when a mid-stream SSE error is overloaded_error", async () => {
    const mid: StreamFn = async () => ({
      events: (async function* () { throw { error: { type: "overloaded_error" } }; yield { type: "text" as const, text: "" }; })(),
      final: async () => ({ inputTokens: 0, outputTokens: 0, stop: "end_turn" }),
      usageSoFar: () => ({ inputTokens: 0, outputTokens: 0 }),
    });
    const t = await signSession({ vid: "vid-overloaded", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
    const { text } = await post(doc, t, mid);
    expect(text).toContain('event: error\ndata: {"error":"busy"}');
  });

  it("keeps only the admission estimate when aborted before message_start", async () => {
    const t = await signSession({ vid: "vid-early", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
    const early: StreamFn = async () => ({
      events: (async function* () { await new Promise(() => {}); yield { type: "text" as const, text: "" }; })(),
      final: () => new Promise(() => {}),
      usageSoFar: () => ({ inputTokens: 0, outputTokens: 0 }),
    });
    const body = { task: "summarize", document: [{ page: 1, text: "x".repeat(3500) }] };
    const req = new Request("https://ai.example/ai", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify(body),
    });
    const ctx = createExecutionContext();
    const res = await aiHandler(req, env, ctx, early);
    const reader = res.body!.getReader();
    await reader.cancel();
    await waitOnExecutionContext(ctx);
    const state = await env.QUOTA.get(`q:vid-early:${new Date().toISOString().slice(0, 10)}`, "json");
    expect(state).toEqual({ requests: 1, tokens: 1000 });
  });

  it("charges tokens used so far when the client disconnects mid-stream", async () => {
    const t = await signSession({ vid: "vid-cancel", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
    const hang: StreamFn = async () => ({
      events: (async function* () { yield { type: "text" as const, text: "partial" }; await new Promise(() => {}); })(),
      final: () => new Promise(() => {}),
      usageSoFar: () => ({ inputTokens: 500, outputTokens: 10 }),
    });
    const req = new Request("https://ai.example/ai", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify(doc),
    });
    const ctx = createExecutionContext();
    const res = await aiHandler(req, env, ctx, hang);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("partial");
    await reader.cancel();
    await waitOnExecutionContext(ctx);
    const state = await env.QUOTA.get(`q:vid-cancel:${new Date().toISOString().slice(0, 10)}`, "json");
    expect(state).toEqual({ requests: 1, tokens: 510 });
  });

  it("owner sessions bypass the daily limit and report unlimited", async () => {
    const t = await signSession({ vid: "vid-owner", exp: Math.floor(Date.now() / 1000) + 3600, owner: true }, env.SESSION_SECRET);
    const day = new Date().toISOString().slice(0, 10);
    await env.QUOTA.put(`q:vid-owner:${day}`, JSON.stringify({ requests: DAILY_REQUESTS, tokens: 10_000_000 }));
    const { res, text } = await post(doc, t);
    expect(res.status).toBe(200);
    expect(text).toContain("event: done");
    expect(text).toContain('"remaining":null');
    expect(text).toContain('"unlimited":true');
    expect(await env.QUOTA.get(`q:vid-owner:${day}`, "json")).toEqual({ requests: DAILY_REQUESTS, tokens: 10_000_000 });
    expect(await env.QUOTA.get(`b:vid-owner`)).toBeNull();
  });
});
