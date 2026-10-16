import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { setJwksForTest } from "../src/clerk";
import { desktopTicketHandler, configureDesktopTicketFetch } from "../src/handlers/desktopTicket";
import { makeSigner, good } from "./jwt-helpers";

let sign: (p: Record<string, unknown>) => Promise<string>;
beforeAll(async () => { const s = await makeSigner(); sign = s.sign; setJwksForTest([s.jwk]); });

const calls: { url: string; init: RequestInit }[] = [];
const okFetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ token: "tkt_abc", status: "pending" }), { status: 200 }); }) as unknown as typeof fetch;
afterEach(() => { calls.length = 0; configureDesktopTicketFetch(okFetch); });

const post = (auth: string | null, e = env) => desktopTicketHandler(new Request("https://ai.example/desktop/ticket", { method: "POST", headers: auth ? { authorization: `Bearer ${auth}` } : {} }), { ...e, ALLOWED_ORIGIN: "http://localhost:5173" });

describe("POST /desktop/ticket", () => {
  it("401 without a token or with a bad one", async () => {
    configureDesktopTicketFetch(okFetch);
    expect((await post(null)).status).toBe(401);
    expect((await post("not.a.jwt")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("issues a 300 s ticket for the caller only, no-store", async () => {
    configureDesktopTicketFetch(okFetch);
    const res = await post(await sign({ ...good(), sub: "user_t1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ticket: "tkt_abc" });
    expect(calls[0].url).toBe("https://api.clerk.com/v1/sign_in_tokens");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ user_id: "user_t1", expires_in_seconds: 300 });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${env.CLERK_SECRET_KEY}`);
  });
  it("429 on the 6th ticket in a minute", async () => {
    configureDesktopTicketFetch(okFetch);
    const t = await sign({ ...good(), sub: "user_rl" });
    for (let i = 0; i < 5; i++) expect((await post(t)).status).toBe(200);
    const r = await post(t);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "rate_limited" });
  });
  it("503 when accounts are not configured", async () => {
    const r = await post(await sign(good()), { ...env, CLERK_SECRET_KEY: "" });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "accounts_unavailable" });
  });
  it("502 on a Clerk error without echoing its body", async () => {
    configureDesktopTicketFetch((async () => new Response("secret clerk detail", { status: 500 })) as unknown as typeof fetch);
    const r = await post(await sign({ ...good(), sub: "user_err" }));
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("secret clerk detail");
  });
});
