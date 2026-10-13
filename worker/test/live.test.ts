import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { liveHandler, liveUsageHandler, type LiveDeps } from "../src/handlers/live";
import { ElevenLabsError } from "../src/elevenlabs";
import { signSession } from "../src/session";
import { SETTLE_WINDOW_S } from "../src/voiceQuota";

const day = new Date().toISOString().slice(0, 10);
const token = (vid: string) => signSession({ vid, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
const old = () => Date.now() / 1000 - (SETTLE_WINDOW_S + 100);
const okDeps = (): LiveDeps => ({ createToken: async () => ({ token: "tok", conversationId: "conv_1" }), getDuration: async () => 95 });

async function call(handler: typeof liveHandler, path: string, body: unknown, vid?: string, deps: LiveDeps = okDeps()) {
  const req = new Request(`https://ai.example${path}`, { method: "POST", headers: { "content-type": "application/json", ...(vid ? { authorization: `Bearer ${await token(vid)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = createExecutionContext();
  const res = await handler(req, env, deps);
  const json = (await res.json().catch(() => null)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  await waitOnExecutionContext(ctx);
  return { res, json };
}

describe("POST /live", () => {
  it("401 without a session", async () => { expect((await call(liveHandler, "/live", undefined)).res.status).toBe(401); });
  it("mints a token, charges 600 s, returns the remainder", async () => {
    let seenAgent = "";
    const deps: LiveDeps = { ...okDeps(), createToken: async (key, agent) => { expect(key).toBe("el-test-key"); seenAgent = agent; return { token: "tok", conversationId: "conv_1" }; } };
    const { res, json } = await call(liveHandler, "/live", undefined, "v-live-1", deps);
    expect(res.status).toBe(200);
    expect(seenAgent).toBe("agent_test");
    expect(json).toMatchObject({ conversationId: "conv_1", token: "tok", remainingSeconds: 1200 });
    expect(json.resetAt).toBeGreaterThan(Date.now() / 1000);
    expect(await env.QUOTA.get(`v:v-live-1:${day}`, "json")).toMatchObject({ seconds: 600, charged: { conv_1: 600 } });
  });
  it("429 voice_limit when 600 s would exceed the day", async () => {
    await env.QUOTA.put(`v:v-live-2:${day}`, JSON.stringify({ seconds: 1300, charged: { a: 1300 }, admitted: {}, pending: {} }));
    let minted = false;
    const { res, json } = await call(liveHandler, "/live", undefined, "v-live-2", { ...okDeps(), createToken: async () => { minted = true; return { token: "t", conversationId: "c" }; } });
    expect(res.status).toBe(429);
    expect(json.error).toBe("voice_limit");
    expect(typeof json.resetAt).toBe("number");
    expect(json).toMatchObject({ remainingSeconds: 500, sessionSeconds: 600 });
    expect(minted).toBe(false);
  });
  it("502 voice_unavailable when ElevenLabs fails, without charging", async () => {
    const { res, json } = await call(liveHandler, "/live", undefined, "v-live-3", { ...okDeps(), createToken: async () => { throw new ElevenLabsError(500, "upstream"); } });
    expect(res.status).toBe(502);
    expect(json.error).toBe("voice_unavailable");
    expect(await env.QUOTA.get(`v:v-live-3:${day}`, "json")).toBeNull();
  });
  it("honours VOICE_DAILY_SECONDS", async () => {
    const small = Object.create(env, { VOICE_DAILY_SECONDS: { value: "500" } }) as typeof env; // prototype keeps the KV binding; defineProperty so env itself is not mutated
    const req = new Request("https://ai.example/live", { method: "POST", headers: { authorization: `Bearer ${await token("v-live-4")}` } });
    const res = await liveHandler(req, small, okDeps());
    expect(res.status).toBe(429);
  });
});

describe("owner sessions", () => {
  const ownerToken = (vid: string) => signSession({ vid, exp: Math.floor(Date.now() / 1000) + 3600, owner: true }, env.SESSION_SECRET);
  async function ownerCall(handler: typeof liveHandler, path: string, body: unknown, vid: string, deps: LiveDeps = okDeps()) {
    const req = new Request(`https://ai.example${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await ownerToken(vid)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await handler(req, env, deps);
    return { res, json: (await res.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  it("skips admission and charging, still mints a token", async () => {
    await env.QUOTA.put(`v:v-owner-1:${day}`, JSON.stringify({ seconds: 1800, charged: { a: 1800 }, admitted: {}, pending: {} }));
    const { res, json } = await ownerCall(liveHandler, "/live", undefined, "v-owner-1");
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ conversationId: "conv_1", token: "tok", remainingSeconds: null, unlimited: true });
    expect(await env.QUOTA.get(`v:v-owner-1:${day}`, "json")).toMatchObject({ seconds: 1800, charged: { a: 1800 } });
  });
  it("/live/usage is a no-op success", async () => {
    let asked = false;
    const { res, json } = await ownerCall(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 500 }, "v-owner-2", { ...okDeps(), getDuration: async () => { asked = true; return 1; } });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ remainingSeconds: null, unlimited: true });
    expect(asked).toBe(false);
    expect(await env.QUOTA.get(`v:v-owner-2:${day}`, "json")).toBeNull();
  });
});

describe("POST /live/usage", () => {
  it("400 on an invalid body", async () => {
    expect((await call(liveUsageHandler, "/live/usage", { conversationId: 5 }, "v-use-0")).res.status).toBe(400);
    expect((await call(liveUsageHandler, "/live/usage", { conversationId: "c", seconds: 9999 }, "v-use-0")).res.status).toBe(400);
  });
  it("reconciles from the ElevenLabs record", async () => {
    await env.QUOTA.put(`v:v-use-1:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 }, admitted: { conv_1: old() }, pending: {} }));
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 500 }, "v-use-1", { ...okDeps(), getDuration: async (_k, id) => (id === "conv_1" ? 95 : null) });
    expect(res.status).toBe(200);
    expect(json).toEqual({ remainingSeconds: 1705 });
    expect(await env.QUOTA.get(`v:v-use-1:${day}`, "json")).toMatchObject({ seconds: 95, charged: { conv_1: 95 } });
  });
  it("falls back to the client's seconds when the record is unavailable", async () => {
    await env.QUOTA.put(`v:v-use-2:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 }, admitted: { conv_1: old() }, pending: {} }));
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 130 }, "v-use-2", { ...okDeps(), getDuration: async () => null });
    expect(res.status).toBe(200);
    expect(json).toEqual({ remainingSeconds: 1670 });
  });
  it("does not lower the charge from an unverified report inside the session window", async () => {
    await env.QUOTA.put(`v:v-use-5:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 }, admitted: { conv_1: Date.now() / 1000 - 100 }, pending: {} }));
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 0 }, "v-use-5", { ...okDeps(), getDuration: async () => null });
    expect(res.status).toBe(200);
    expect(json).toEqual({ remainingSeconds: 1200 });
    expect(await env.QUOTA.get(`v:v-use-5:${day}`, "json")).toMatchObject({ charged: { conv_1: 600 }, pending: { conv_1: 0 } });
  });
  it("404 unknown_conversation for an id this visitor never charged", async () => {
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "ghost", seconds: 10 }, "v-use-3");
    expect(res.status).toBe(404);
    expect(json.error).toBe("unknown_conversation");
  });
  it("is idempotent", async () => {
    await env.QUOTA.put(`v:v-use-4:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 }, admitted: { conv_1: old() }, pending: {} }));
    await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 20 }, "v-use-4", { ...okDeps(), getDuration: async () => 40 });
    const { json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 20 }, "v-use-4", { ...okDeps(), getDuration: async () => 40 });
    expect(json).toEqual({ remainingSeconds: 1760 });
  });
});

describe("POST /live with PAYWALL_ENABLED", () => {
  const on = { ...env, PAYWALL_ENABLED: "true" } as typeof env;
  const exp = () => Math.floor(Date.now() / 1000) + 600;
  const liveAs = async (payload: Parameters<typeof signSession>[0], deps: LiveDeps = okDeps()) => {
    const tok = await signSession(payload, env.SESSION_SECRET);
    const res = await liveHandler(new Request("https://ai.example/live", { method: "POST", headers: { authorization: `Bearer ${tok}` } }), on, deps);
    return { res, json: (await res.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  it("anon -> 403 account_required", async () => {
    const { res, json } = await liveAs({ vid: "anon-live", exp: exp() });
    expect(res.status).toBe(403);
    expect(json).toMatchObject({ error: "account_required" });
  });
  it("free user, 0 s used -> 200 reserving the 300 s allowance", async () => {
    const { res, json } = await liveAs({ vid: "u:user_l1", uid: "user_l1", plan: "free", exp: exp() });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ maxSeconds: 300, remainingSeconds: 0 });
    expect(await env.QUOTA.get(`v:u:user_l1:${day}`, "json")).toMatchObject({ seconds: 300, charged: { conv_1: 300 } });
    expect(await env.QUOTA.get(`m:voice:u:user_l1:${new Date().toISOString().slice(0, 7)}`)).toBe("300");
  });
  it("free user with 300 s used today -> 429 voice_limit", async () => {
    await env.QUOTA.put(`v:u:user_l2:${day}`, JSON.stringify({ seconds: 300, charged: { a: 300 }, admitted: {}, pending: {} }));
    const { res, json } = await liveAs({ vid: "u:user_l2", uid: "user_l2", plan: "free", exp: exp() });
    expect(res.status).toBe(429);
    expect(json).toMatchObject({ error: "voice_limit", remainingSeconds: 0, sessionSeconds: 60, scope: "day" });
  });
  it("month allowance used up -> 429 voice_limit scope month with the month reset", async () => {
    const d = new Date();
    await env.QUOTA.put(`m:voice:u:user_l6:${d.toISOString().slice(0, 7)}`, String(7200 - 30));
    const { res, json } = await liveAs({ vid: "u:user_l6", uid: "user_l6", plan: "trial", exp: exp() });
    expect(res.status).toBe(429);
    expect(json).toMatchObject({ error: "voice_limit", scope: "month", sessionSeconds: 60, resetAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000 });
  });
  it("a failed month-counter write does not fail the session (fail open)", async () => {
    const failing = new Proxy(env.QUOTA, {
      get(t, k) {
        if (k === "put") return async (key: string, ...rest: unknown[]) => { if (key.startsWith("m:voice:")) throw new Error("kv down"); return (t.put as (...a: unknown[]) => Promise<void>)(key, ...rest); };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as KVNamespace;
    const tok = await signSession({ vid: "u:user_l7", uid: "user_l7", plan: "trial", exp: exp() }, env.SESSION_SECRET);
    const res = await liveHandler(new Request("https://ai.example/live", { method: "POST", headers: { authorization: `Bearer ${tok}` } }), { ...on, QUOTA: failing }, okDeps());
    expect(res.status).toBe(200);
    const usage = await liveUsageHandler(new Request("https://ai.example/live/usage", { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ conversationId: "conv_1", seconds: 95 }) }), { ...on, QUOTA: failing }, okDeps());
    expect(usage.status).toBe(200);
  });
  it("free user with 250 s used (< 60 s left would refuse; 50 s left) -> 429", async () => {
    await env.QUOTA.put(`v:u:user_l3:${day}`, JSON.stringify({ seconds: 250, charged: { a: 250 }, admitted: {}, pending: {} }));
    expect((await liveAs({ vid: "u:user_l3", uid: "user_l3", plan: "free", exp: exp() })).res.status).toBe(429);
  });
  it("pro user with a full allowance -> 200 reserving 600 s", async () => {
    const { res, json } = await liveAs({ vid: "u:user_l4", uid: "user_l4", plan: "trial", exp: exp() });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ maxSeconds: 600, remainingSeconds: 1200 });
  });
  it("owner sessions skip account_required and day/month allowances, reserve 600 s and charge nothing", async () => {
    const month = new Date().toISOString().slice(0, 7);
    await env.QUOTA.put(`v:u:user_lo2:${day}`, JSON.stringify({ seconds: 300, charged: { a: 300 }, admitted: {}, pending: {} }));
    await env.QUOTA.put(`m:voice:u:user_lo2:${month}`, "9300");
    for (const p of [
      { vid: "anon-live-owner", exp: exp(), owner: true as const },
      { vid: "u:user_lo2", uid: "user_lo2", plan: "free" as const, exp: exp(), owner: true as const },
    ]) {
      const { res, json } = await liveAs(p);
      expect(res.status).toBe(200);
      expect(json).toMatchObject({ remainingSeconds: null, unlimited: true, maxSeconds: 600 });
    }
    expect(await env.QUOTA.get(`v:anon-live-owner:${day}`)).toBeNull();
    expect(await env.QUOTA.get(`v:u:user_lo2:${day}`, "json")).toMatchObject({ seconds: 300, charged: { a: 300 } });
    expect(await env.QUOTA.get(`m:voice:u:user_lo2:${month}`)).toBe("9300");
  });
  it("the same free user without owner is still refused", async () => {
    await env.QUOTA.put(`v:u:user_lo3:${day}`, JSON.stringify({ seconds: 300, charged: { a: 300 }, admitted: {}, pending: {} }));
    expect((await liveAs({ vid: "u:user_lo3", uid: "user_lo3", plan: "free", exp: exp() })).res.status).toBe(429);
  });
  it("usage report adjusts the month counter by the settled delta", async () => {
    const payload = { vid: "u:user_l5", uid: "user_l5", plan: "trial" as const, exp: exp() };
    await liveAs(payload);
    const tok = await signSession(payload, env.SESSION_SECRET);
    const res = await liveUsageHandler(new Request("https://ai.example/live/usage", { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ conversationId: "conv_1", seconds: 95 }) }), on, okDeps());
    expect(res.status).toBe(200);
    expect(await env.QUOTA.get(`m:voice:u:user_l5:${new Date().toISOString().slice(0, 7)}`)).toBe("95");
  });
});
