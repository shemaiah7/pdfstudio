import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { signSession, verifySession, visitorId, utcDay, sessionPlan } from "../src/session";
import { sessionHandler, configureSessionDeps } from "../src/handlers/session";
import { setJwksForTest, clerkUserEmail } from "../src/clerk";
import { makeSigner, good } from "./jwt-helpers";
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

describe("POST /session with a Clerk JWT", () => {
  let sign: Awaited<ReturnType<typeof makeSigner>>["sign"];
  beforeAll(async () => {
    const s = await makeSigner();
    sign = s.sign;
    setJwksForTest([s.jwk]);
  });
  afterEach(() => {
    configureSessionDeps({ userEmail: (id, e) => clerkUserEmail(id, e) });
  });

  it("creates the user, issues a 600 s token with plan trial", async () => {
    configureSessionDeps({ userEmail: async () => "new@x.y" });
    const res = await sessionHandler(new Request("https://ai.example/session", { method: "POST", headers: { authorization: `Bearer ${await sign({ ...good(), sub: "user_s1" })}` } }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number; plan: string };
    expect(body.plan).toBe("trial");
    const s = (await verifySession(body.token, env.SESSION_SECRET))!;
    expect(s).toMatchObject({ vid: "u:user_s1", uid: "user_s1", plan: "trial" });
    expect(body.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
  });
  it("401 for an invalid Clerk JWT (never falls back to anonymous)", async () => {
    const res = await sessionHandler(new Request("https://ai.example/session", { method: "POST", headers: { authorization: "Bearer a.b.c" } }), env);
    expect(res.status).toBe(401);
  });
  it("legacy anonymous token without plan reads as anon", async () => {
    expect(sessionPlan({ vid: "abc", exp: 1 })).toBe("anon");
  });
  it("rejects a signed token carrying an unknown plan", async () => {
    const t = await signSession({ vid: "abc", exp: 2_000_000_000, plan: "root" as never }, "s");
    expect(await verifySession(t, "s", 1_900_000_000)).toBeNull();
  });
  it("anonymous Turnstile response includes plan anon", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));
    try {
      const res = await sessionHandler(new Request("https://ai.example/session", {
        method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.7" }, body: JSON.stringify({ turnstileToken: "tok" }),
      }), env);
      expect(((await res.json()) as { plan: string }).plan).toBe("anon");
    } finally { vi.unstubAllGlobals(); }
  });
  it("503 account_unavailable when Clerk email lookup fails for a new user", async () => {
    configureSessionDeps({ userEmail: async () => { throw new Error("clerk_500"); } });
    const res = await sessionHandler(new Request("https://ai.example/session", { method: "POST", headers: { authorization: `Bearer ${await sign({ ...good(), sub: "user_s2" })}` } }), env);
    expect(res.status).toBe(503);
  });
  it("adds owner:true for a valid owner key sent alongside the Clerk JWT", async () => {
    const OWNER = "owner-key-0123456789-abcdefghijklmnopqrstuvwxyz";
    const e = { ...env, OWNER_KEY: OWNER } as typeof env;
    configureSessionDeps({ userEmail: async () => "own@x.y" });
    const res = await sessionHandler(new Request("https://ai.example/session", {
      method: "POST", headers: { authorization: `Bearer ${await sign({ ...good(), sub: "user_own1" })}`, "content-type": "application/json" }, body: JSON.stringify({ ownerKey: OWNER }),
    }), e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; plan: string; owner?: true };
    expect(body.owner).toBe(true);
    expect(body.plan).toBe("trial");
    expect(await verifySession(body.token, env.SESSION_SECRET)).toMatchObject({ vid: "u:user_own1", uid: "user_own1", plan: "trial", owner: true });
  });
  it("ignores an invalid or missing owner key on the Clerk path", async () => {
    const OWNER = "owner-key-0123456789-abcdefghijklmnopqrstuvwxyz";
    const e = { ...env, OWNER_KEY: OWNER } as typeof env;
    configureSessionDeps({ userEmail: async () => "own2@x.y" });
    for (const init of [{ body: JSON.stringify({ ownerKey: "wrong-key-wrong-key-wrong-key-wrong-key" }) }, { body: "not json" }, {}]) {
      const res = await sessionHandler(new Request("https://ai.example/session", {
        method: "POST", headers: { authorization: `Bearer ${await sign({ ...good(), sub: "user_own2" })}` }, ...init,
      }), e);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string; owner?: true };
      expect("owner" in body).toBe(false);
      expect((await verifySession(body.token, env.SESSION_SECRET))?.owner).toBeUndefined();
    }
  });
  it("rejects a signed token with a non-true owner value", async () => {
    const t = await signSession({ vid: "abc", exp: 2_000_000_000, owner: "yes" as never }, "s");
    expect(await verifySession(t, "s", 1_900_000_000)).toBeNull();
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
