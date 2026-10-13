import { describe, it, expect, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { signSession, verifySession, visitorId, utcDay } from "../src/session";
import { verifyTurnstile } from "../src/turnstile";
import worker from "../src/index";

describe("session tokens", () => {
  it("round-trips", async () => {
    const t = await signSession({ vid: "abc", exp: 2_000_000_000 }, "s");
    expect(await verifySession(t, "s", 1_900_000_000)).toEqual({ vid: "abc", exp: 2_000_000_000 });
  });
  it("rejects tampering", async () => {
    const t = await signSession({ vid: "abc", exp: 2_000_000_000 }, "s");
    const [p, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ vid: "zzz", exp: 2_000_000_000 })).replace(/=+$/, "") + "." + sig;
    expect(await verifySession(forged, "s", 1_900_000_000)).toBeNull();
    expect(await verifySession(p + ".bad", "s", 1_900_000_000)).toBeNull();
    expect(await verifySession("garbage", "s")).toBeNull();
  });
  it("rejects expired", async () => {
    const t = await signSession({ vid: "abc", exp: 100 }, "s");
    expect(await verifySession(t, "s", 101)).toBeNull();
  });
  it("visitor id is stable per ip+day and 16 hex chars", async () => {
    const a = await visitorId("1.2.3.4", "s", "2026-10-10");
    const b = await visitorId("1.2.3.4", "s", "2026-10-10");
    const c = await visitorId("1.2.3.4", "s", "2026-10-11");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("utcDay formats", () => {
    expect(utcDay(Date.UTC(2026, 9, 10, 23, 59, 59) / 1000)).toBe("2026-10-10");
  });
});

describe("verifyTurnstile", () => {
  const fakeFetch = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("accepts success with allowed hostname", async () => {
    expect(await verifyTurnstile("tok", "1.1.1.1", env, fakeFetch({ success: true, hostname: "localhost" }))).toBe(true);
  });
  it("rejects wrong hostname or failure", async () => {
    expect(await verifyTurnstile("tok", "1.1.1.1", env, fakeFetch({ success: true, hostname: "evil.com" }))).toBe(false);
    expect(await verifyTurnstile("tok", "1.1.1.1", env, fakeFetch({ success: false }))).toBe(false);
  });
  it("rejects when siteverify is down", async () => {
    const down = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "1.1.1.1", env, down)).toBe(false);
  });
});

describe("POST /session", () => {
  it("returns a token when Turnstile passes", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));
    const req = new Request("https://ai.example/session", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" },
      body: JSON.stringify({ turnstileToken: "tok" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(body.token.split(".").length).toBe(2);
    expect(body.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });
  it("caps expiry at the next UTC midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 10, 23, 0, 0)));
    try {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));
      const req = new Request("https://ai.example/session", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.8" },
        body: JSON.stringify({ turnstileToken: "tok" }),
      });
      const res = await worker.fetch(req, env, createExecutionContext());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { expiresAt: number };
      expect(body.expiresAt).toBe(Date.UTC(2026, 9, 11) / 1000);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
  it("403s when Turnstile fails", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false })));
    const req = new Request("https://ai.example/session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "tok" }),
    });
    const res = await worker.fetch(req, env, createExecutionContext());
    vi.unstubAllGlobals();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verification_failed" });
  });
});

describe("POST /session owner key", () => {
  const OWNER = "owner-key-0123456789-abcdefghijklmnopqrstuvwxyz";
  const withOwner = (key?: string) => ({ ...env, ...(key === undefined ? {} : { OWNER_KEY: key }) }) as typeof env;
  async function mint(e: typeof env, body: Record<string, unknown>) {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));
    try {
      const req = new Request("https://ai.example/session", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.7" }, body: JSON.stringify({ turnstileToken: "tok", ...body }) });
      const res = await worker.fetch(req, e, createExecutionContext());
      return { res, json: (await res.json()) as { token: string; expiresAt: number; owner?: true } };
    } finally { vi.unstubAllGlobals(); }
  }
  it("grants an owner session for the right key", async () => {
    const { res, json } = await mint(withOwner(OWNER), { ownerKey: OWNER });
    expect(res.status).toBe(200);
    expect(json.owner).toBe(true);
    expect(await verifySession(json.token, env.SESSION_SECRET)).toMatchObject({ owner: true });
  });
  it("gives a normal session for a wrong or missing key", async () => {
    for (const body of [{ ownerKey: "wrong-key-wrong-key-wrong-key-wrong-key" }, {}, { ownerKey: 5 }, { ownerKey: "" }]) {
      const { res, json } = await mint(withOwner(OWNER), body);
      expect(res.status).toBe(200);
      expect("owner" in json).toBe(false);
      expect((await verifySession(json.token, env.SESSION_SECRET))?.owner).toBeUndefined();
    }
  });
  it("never grants owner when OWNER_KEY is shorter than 32 characters", async () => {
    const short = "short-key-1234567890";
    const { json } = await mint(withOwner(short), { ownerKey: short });
    expect("owner" in json).toBe(false);
  });
  it("never grants owner when OWNER_KEY is unset", async () => {
    const { json } = await mint(withOwner(), { ownerKey: OWNER });
    expect("owner" in json).toBe(false);
    const empty = await mint(withOwner(""), { ownerKey: "" });
    expect("owner" in empty.json).toBe(false);
  });
  it("still requires Turnstile for the owner", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false })));
    const req = new Request("https://ai.example/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnstileToken: "tok", ownerKey: OWNER }) });
    const res = await worker.fetch(req, withOwner(OWNER), createExecutionContext());
    vi.unstubAllGlobals();
    expect(res.status).toBe(403);
  });
  it("rejects a token whose payload was edited to add owner:true", async () => {
    const t = await signSession({ vid: "abc", exp: 2_000_000_000 }, "s");
    const sig = t.split(".")[1];
    const forged = btoa(JSON.stringify({ vid: "abc", exp: 2_000_000_000, owner: true })).replace(/=+$/, "") + "." + sig;
    expect(await verifySession(forged, "s", 1_900_000_000)).toBeNull();
    const owner = await signSession({ vid: "abc", exp: 2_000_000_000, owner: true }, "s");
    expect(await verifySession(owner, "s", 1_900_000_000)).toEqual({ vid: "abc", exp: 2_000_000_000, owner: true });
  });
});
