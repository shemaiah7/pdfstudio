import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { liveHandler, liveUsageHandler, type LiveDeps } from "../src/handlers/live";
import { ElevenLabsError } from "../src/elevenlabs";
import { signSession } from "../src/session";

const day = new Date().toISOString().slice(0, 10);
const token = (vid: string) => signSession({ vid, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
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
    expect(await env.QUOTA.get(`v:v-live-1:${day}`, "json")).toEqual({ seconds: 600, charged: { conv_1: 600 } });
  });
  it("429 voice_limit when 600 s would exceed the day", async () => {
    await env.QUOTA.put(`v:v-live-2:${day}`, JSON.stringify({ seconds: 1300, charged: { a: 1300 } }));
    let minted = false;
    const { res, json } = await call(liveHandler, "/live", undefined, "v-live-2", { ...okDeps(), createToken: async () => { minted = true; return { token: "t", conversationId: "c" }; } });
    expect(res.status).toBe(429);
    expect(json.error).toBe("voice_limit");
    expect(typeof json.resetAt).toBe("number");
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

describe("POST /live/usage", () => {
  it("400 on an invalid body", async () => {
    expect((await call(liveUsageHandler, "/live/usage", { conversationId: 5 }, "v-use-0")).res.status).toBe(400);
    expect((await call(liveUsageHandler, "/live/usage", { conversationId: "c", seconds: 9999 }, "v-use-0")).res.status).toBe(400);
  });
  it("reconciles from the ElevenLabs record", async () => {
    await env.QUOTA.put(`v:v-use-1:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 } }));
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 500 }, "v-use-1", { ...okDeps(), getDuration: async (_k, id) => (id === "conv_1" ? 95 : null) });
    expect(res.status).toBe(200);
    expect(json).toEqual({ remainingSeconds: 1705 });
    expect(await env.QUOTA.get(`v:v-use-1:${day}`, "json")).toEqual({ seconds: 95, charged: { conv_1: 95 } });
  });
  it("falls back to the client's seconds when the record is unavailable", async () => {
    await env.QUOTA.put(`v:v-use-2:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 } }));
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 130 }, "v-use-2", { ...okDeps(), getDuration: async () => null });
    expect(res.status).toBe(200);
    expect(json).toEqual({ remainingSeconds: 1670 });
  });
  it("404 unknown_conversation for an id this visitor never charged", async () => {
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "ghost", seconds: 10 }, "v-use-3");
    expect(res.status).toBe(404);
    expect(json.error).toBe("unknown_conversation");
  });
  it("is idempotent", async () => {
    await env.QUOTA.put(`v:v-use-4:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 } }));
    await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 20 }, "v-use-4", { ...okDeps(), getDuration: async () => 40 });
    const { json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 20 }, "v-use-4", { ...okDeps(), getDuration: async () => 40 });
    expect(json).toEqual({ remainingSeconds: 1760 });
  });
});
