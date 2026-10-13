import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { ocrHandler } from "../src/handlers/ocr";
import type { OcrFn } from "../src/claude";
import { signSession } from "../src/session";

const token = () => signSession({ vid: "vid-ocr", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
async function post(body: unknown, tok?: string, ocr: OcrFn = async () => ({ text: "line one\nline two\n", inputTokens: 1500, outputTokens: 20 })) {
  const req = new Request("https://ai.example/ocr", { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
  const ctx = createExecutionContext();
  const res = await ocrHandler(req, env, ctx, ocr);
  const json = (await res.json().catch(() => null)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  await waitOnExecutionContext(ctx);
  return { res, json };
}
const body = { task: "ocr", pages: [{ page: 3, image: "/9j/4AAQ" }, { page: 5, image: "/9j/4AAQ" }] };

describe("POST /ocr", () => {
  it("401 without a session", async () => { expect((await post(body)).res.status).toBe(401); });
  it("400 on invalid body", async () => { expect((await post({ task: "ocr" }, await token())).res.status).toBe(400); });
  it("transcribes each page, splits lines, charges one request per page", async () => {
    const calls: string[] = [];
    const { res, json } = await post(body, await token(), async (image) => { calls.push(image); return { text: "a\n\nb\n", inputTokens: 10, outputTokens: 2 }; });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(json.pages).toEqual([{ page: 3, lines: ["a", "b"] }, { page: 5, lines: ["a", "b"] }]);
    expect(json.failed).toEqual([]);
    expect(json.remaining.requests).toBe(18);
    const state = await env.QUOTA.get(`q:vid-ocr:${new Date().toISOString().slice(0, 10)}`, "json");
    expect(state).toMatchObject({ requests: 2 });
  });
  it("reports a failed page without failing the batch", async () => {
    let n = 0;
    const { res, json } = await post(body, await token(), async () => { if (n++ === 0) throw Object.assign(new Error("boom"), { status: 500 }); return { text: "ok", inputTokens: 1, outputTokens: 1 }; });
    expect(res.status).toBe(200);
    expect(json.pages).toEqual([{ page: 5, lines: ["ok"] }]);
    expect(json.failed).toEqual([3]);
  });
  it("429 when the daily request quota cannot cover the batch", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.QUOTA.put(`q:vid-ocr2:${day}`, JSON.stringify({ requests: 19, tokens: 0 }));
    const tok = await signSession({ vid: "vid-ocr2", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
    const { res, json } = await post(body, tok);
    expect(res.status).toBe(429);
    expect(json.error).toBe("daily_limit");
    expect(await env.QUOTA.get(`q:vid-ocr2:${day}`, "json")).toMatchObject({ requests: 19 });
  });
  it("reserves a 3-page batch with one burst write and one day write", async () => {
    const puts: string[] = [];
    const gets: string[] = [];
    const kv = new Proxy(env.QUOTA, {
      get(t, prop) {
        if (prop === "put") return (key: string, ...rest: unknown[]) => {
          if (puts.includes(key)) throw new Error("KV write limit");
          puts.push(key);
          return (t.put as (...a: unknown[]) => Promise<void>)(key, ...rest);
        };
        if (prop === "get") return (key: string, ...rest: unknown[]) => { gets.push(key); return (t.get as (...a: unknown[]) => Promise<unknown>)(key, ...rest); };
        const v = Reflect.get(t, prop);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as KVNamespace;
    const tok = await signSession({ vid: "vid-ocr3", exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
    const req = new Request("https://ai.example/ocr", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ task: "ocr", pages: [1, 2, 3].map((page) => ({ page, image: "/9j/4AAQ" })) }) });
    const ctx = createExecutionContext();
    const res = await ocrHandler(req, { ...env, QUOTA: kv }, ctx, async () => ({ text: "x", inputTokens: 1, outputTokens: 1 }));
    const json = (await res.json()) as { pages: unknown[]; remaining: { requests: number } };
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(json.pages).toHaveLength(3);
    expect(json.remaining.requests).toBe(17);
    expect(puts.filter((k) => k.startsWith("b:"))).toHaveLength(1);
    expect(puts.filter((k) => k.startsWith("q:"))).toHaveLength(1);
    expect(gets).toHaveLength(2);
  });

  it("owner sessions bypass the daily limit for a batch", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.QUOTA.put(`q:vid-ocr-owner:${day}`, JSON.stringify({ requests: 20, tokens: 10_000_000 }));
    const tok = await signSession({ vid: "vid-ocr-owner", exp: Math.floor(Date.now() / 1000) + 3600, owner: true }, env.SESSION_SECRET);
    const { res, json } = await post(body, tok);
    expect(res.status).toBe(200);
    expect(json.pages).toHaveLength(2);
    expect(json.remaining).toBeNull();
    expect(json.unlimited).toBe(true);
    expect(json.resetAt).toBeUndefined();
    expect(await env.QUOTA.get(`q:vid-ocr-owner:${day}`, "json")).toEqual({ requests: 20, tokens: 10_000_000 });
  });
});

async function callOcr(e: typeof env, tok: string, b: unknown) {
  const req = new Request("https://ai.example/ocr", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(b) });
  const ctx = createExecutionContext();
  const res = await ocrHandler(req, e, ctx, async () => ({ text: "x", inputTokens: 1, outputTokens: 1 }));
  await waitOnExecutionContext(ctx);
  return res;
}

describe("/ocr with PAYWALL_ENABLED", () => {
  const on = { ...env, PAYWALL_ENABLED: "true" } as typeof env;
  const exp = () => Math.floor(Date.now() / 1000) + 600;
  it("anon -> 403 account_required", async () => {
    const tok = await signSession({ vid: "anon-ocr", exp: exp() }, env.SESSION_SECRET);
    const res = await callOcr(on, tok, body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "account_required" });
  });
  it("free -> 403 pro_required", async () => {
    const tok = await signSession({ vid: "u:user_o1", uid: "user_o1", plan: "free", exp: exp() }, env.SESSION_SECRET);
    const res = await callOcr(on, tok, body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "pro_required" });
  });
  it("pro whose batch would pass 300 pages/month -> 429 monthly_limit", async () => {
    const tok = await signSession({ vid: "u:user_o2", uid: "user_o2", plan: "pro", exp: exp() }, env.SESSION_SECRET);
    await env.QUOTA.put(`m:ocr:u:user_o2:${new Date().toISOString().slice(0, 7)}`, "299");
    const res = await callOcr(on, tok, body); // 2 pages
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "monthly_limit", scope: "month" });
  });
  it("pro response reports the plan's remaining pages, not the anonymous quota", async () => {
    const tok = await signSession({ vid: "u:user_o4", uid: "user_o4", plan: "trial", exp: exp() }, env.SESSION_SECRET);
    const res = await callOcr(on, tok, body); // 2 pages
    expect(res.status).toBe(200);
    expect(((await res.json()) as { remaining: { requests: number } }).remaining.requests).toBe(298);
  });
  it("over the daily token ceiling -> 429 daily_limit scope day", async () => {
    await env.QUOTA.put(`q:u:user_o5:${new Date().toISOString().slice(0, 10)}`, JSON.stringify({ requests: 0, tokens: 1_000_000 }));
    const tok = await signSession({ vid: "u:user_o5", uid: "user_o5", plan: "trial", exp: exp() }, env.SESSION_SECRET);
    const res = await callOcr(on, tok, body);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "daily_limit", scope: "day" });
  });
  it("flag off: signed-in free user uses the old anonymous quota", async () => {
    const tok = await signSession({ vid: "u:user_o3", uid: "user_o3", plan: "free", exp: exp() }, env.SESSION_SECRET);
    expect((await callOcr(env, tok, body)).status).toBe(200);
  });
  it("owner sessions skip account_required, pro_required and monthly limits and report unlimited", async () => {
    const month = new Date().toISOString().slice(0, 7);
    await env.QUOTA.put(`m:ocr:u:user_ow3:${month}`, "300");
    const cases = [
      { vid: "anon-ocr-owner", exp: exp(), owner: true as const },
      { vid: "u:user_ow1", uid: "user_ow1", plan: "free" as const, exp: exp(), owner: true as const },
      { vid: "u:user_ow3", uid: "user_ow3", plan: "pro" as const, exp: exp(), owner: true as const },
    ];
    for (const p of cases) {
      const res = await callOcr(on, await signSession(p, env.SESSION_SECRET), body);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ remaining: null, unlimited: true });
    }
    expect(await env.QUOTA.get(`m:ocr:u:user_ow3:${month}`)).toBe("300");
  });
});
