import { describe, it, expect, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { LIMITS, monthKey } from "../src/limits";
import { utcDay } from "../src/session";
import { cancelCustomerSubscriptions as realCancel } from "../src/stripe";
import { deleteClerkUser as realClerk } from "../src/clerk";
import { meHandler, termsHandler, deleteAccountHandler, configureMeDeps } from "../src/handlers/me";
import { signSession } from "../src/session";
import { ensureUser, getUser } from "../src/users";
import { TERMS_VERSION } from "../src/terms";
import { cancelCustomerSubscriptions, setStripeFetch } from "../src/stripe";

const tok = (uid: string, plan: "trial" | "pro" | "free" = "trial") => signSession({ vid: `u:${uid}`, uid, plan, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
const post = async (h: typeof meHandler, t: string | null, body?: unknown) => h(new Request("https://ai.example/x", { method: "POST", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

afterEach(() => {
  configureMeDeps({ cancelSubscription: realCancel, deleteClerkUser: (id, e) => realClerk(id, e) });
  setStripeFetch((async () => { throw new Error("unexpected stripe fetch"); }) as unknown as typeof fetch);
});
const anonTok = () => signSession({ vid: "x", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);

describe("/me", () => {
  it("reports seeded usage from the limits.ts keys", async () => {
    const now = Math.floor(Date.now() / 1000);
    await ensureUser(env.DB, "user_me2", "m2@x.y", now);
    const mk = monthKey("trial", null, now), day = utcDay(now), vid = "u:user_me2";
    await env.QUOTA.put(`d:ai:${vid}:${day}`, "3");
    await env.QUOTA.put(`m:ai:${vid}:${mk}`, "7");
    await env.QUOTA.put(`m:ocr:${vid}:${mk}`, "11");
    await env.QUOTA.put(`m:voice:${vid}:${mk}`, "90");
    const body = (await (await post(meHandler, await tok("user_me2"))).json()) as Record<string, unknown>;
    expect(body.usage).toMatchObject({ aiDay: 3, aiMonth: 7, ocrMonth: 11, voiceMonthSec: 90 });
    expect(body.limits).toEqual(LIMITS.trial);
  });
  it("anon token → plan anon only", async () => {
    const t = await signSession({ vid: "x", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    expect(await (await post(meHandler, t)).json()).toEqual({ plan: "anon", paywall: false });
  });
  it("user → plan, trial end, terms state, zero usage", async () => {
    await ensureUser(env.DB, "user_me1", "m@x.y", Math.floor(Date.now() / 1000));
    const body = (await (await post(meHandler, await tok("user_me1"))).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ plan: "trial", termsAccepted: false, termsVersion: TERMS_VERSION, usage: { aiDay: 0, aiMonth: 0, voiceDaySec: 0, voiceMonthSec: 0, ocrMonth: 0 } });
  });
  it("owner sessions add owner: true (user and anonymous); non-owner has no owner field", async () => {
    await ensureUser(env.DB, "user_me3", "m3@x.y", Math.floor(Date.now() / 1000));
    const exp = Math.floor(Date.now() / 1000) + 600;
    const u = await signSession({ vid: "u:user_me3", uid: "user_me3", plan: "trial", exp, owner: true }, env.SESSION_SECRET);
    expect(await (await post(meHandler, u)).json()).toMatchObject({ plan: "trial", owner: true });
    const a = await signSession({ vid: "x", exp, owner: true }, env.SESSION_SECRET);
    expect(await (await post(meHandler, a)).json()).toEqual({ plan: "anon", paywall: false, owner: true });
    expect("owner" in ((await (await post(meHandler, await tok("user_me3"))).json()) as object)).toBe(false);
  });
  it("401 without a token", async () => { expect((await post(meHandler, null)).status).toBe(401); });
});
describe("/terms/accept", () => {
  it("401 without token or with anon token", async () => {
    expect((await post(termsHandler, null, { version: TERMS_VERSION })).status).toBe(401);
    expect((await post(termsHandler, await anonTok(), { version: TERMS_VERSION })).status).toBe(401);
  });
  it("stores the current version, rejects others", async () => {
    await ensureUser(env.DB, "user_t1", "t@x.y", 1);
    expect((await post(termsHandler, await tok("user_t1"), { version: "old" })).status).toBe(400);
    expect((await post(termsHandler, await tok("user_t1"), { version: TERMS_VERSION })).status).toBe(200);
    expect((await getUser(env.DB, "user_t1"))?.terms_version).toBe(TERMS_VERSION);
  });
});
describe("/account/delete", () => {
  it("401 without token or with anon token", async () => {
    expect((await post(deleteAccountHandler, null)).status).toBe(401);
    expect((await post(deleteAccountHandler, await anonTok())).status).toBe(401);
  });
  it("purges the user's KV counters but not other users'", async () => {
    configureMeDeps({ cancelSubscription: async () => {}, deleteClerkUser: async () => {} });
    await ensureUser(env.DB, "user_k1", "k@x.y", 1);
    const mine = ["d:ai:u:user_k1:2026-01-01", "d:ocr:u:user_k1:2026-01-01", "m:ai:u:user_k1:2026-01", "m:ocr:u:user_k1:2026-01", "m:voice:u:user_k1:2026-01", "v:u:user_k1:2026-01-01", "q:u:user_k1:2026-01-01", "b:u:user_k1:123"];
    const other = ["d:ai:u:user_k10:2026-01-01", "m:ai:u:user_k2:2026-01"];
    for (const k of [...mine, ...other]) await env.QUOTA.put(k, "1");
    expect((await post(deleteAccountHandler, await tok("user_k1"))).status).toBe(200);
    for (const k of mine) expect(await env.QUOTA.get(k)).toBeNull();
    for (const k of other) expect(await env.QUOTA.get(k)).toBe("1");
  });
  it("Stripe failure → 503, row and Clerk untouched", async () => {
    const calls: string[] = [];
    configureMeDeps({ cancelSubscription: async () => { throw new Error("boom"); }, deleteClerkUser: async (id) => { calls.push(id); } });
    await ensureUser(env.DB, "user_f1", "f@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id = 'cus_f1' WHERE id = 'user_f1'").run();
    expect((await post(deleteAccountHandler, await tok("user_f1"))).status).toBe(503);
    expect(calls).toEqual([]);
    expect(await getUser(env.DB, "user_f1")).not.toBeNull();
  });
  it("Clerk failure → 503, row gone; retry succeeds", async () => {
    const calls: string[] = [];
    let fail = true;
    configureMeDeps({ cancelSubscription: async () => {}, deleteClerkUser: async (id) => { calls.push(id); if (fail) throw new Error("boom"); } });
    await ensureUser(env.DB, "user_f2", "f2@x.y", 1);
    const t = await tok("user_f2");
    expect((await post(deleteAccountHandler, t)).status).toBe(503);
    expect(await getUser(env.DB, "user_f2")).toBeNull();
    fail = false;
    expect((await post(deleteAccountHandler, t)).status).toBe(200);
    expect(calls).toEqual(["user_f2", "user_f2"]);
  });
  it("cancels Stripe, deletes Clerk user and the row", async () => {
    const calls: string[] = [];
    configureMeDeps({ cancelSubscription: async (c) => { calls.push(`cancel:${c}`); }, deleteClerkUser: async (id) => { calls.push(`clerk:${id}`); } });
    await ensureUser(env.DB, "user_d1", "d@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id = 'cus_d1' WHERE id = 'user_d1'").run();
    expect((await post(deleteAccountHandler, await tok("user_d1"))).status).toBe(200);
    expect(calls).toEqual(["cancel:cus_d1", "clerk:user_d1"]);
    expect(await getUser(env.DB, "user_d1")).toBeNull();
  });
});
describe("cancelCustomerSubscriptions", () => {
  it("cancels active subscriptions, skips canceled", async () => {
    const calls: string[] = [];
    setStripeFetch((async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(url).replace("https://api.stripe.com/v1", "")}`);
      return new Response(JSON.stringify({ data: [{ id: "sub_a", status: "active" }, { id: "sub_b", status: "canceled" }] }), { status: 200 });
    }) as unknown as typeof fetch);
    await cancelCustomerSubscriptions("cus_1", env);
    expect(calls).toEqual(["GET /subscriptions?customer=cus_1&status=all&limit=20", "DELETE /subscriptions/sub_a"]);
  });
});
