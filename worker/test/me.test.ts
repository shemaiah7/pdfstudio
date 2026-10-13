import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { meHandler, termsHandler, deleteAccountHandler, configureMeDeps } from "../src/handlers/me";
import { signSession } from "../src/session";
import { ensureUser, getUser } from "../src/users";
import { TERMS_VERSION } from "../src/terms";
import { cancelCustomerSubscriptions, setStripeFetch } from "../src/stripe";

const tok = (uid: string, plan: "trial" | "pro" | "free" = "trial") => signSession({ vid: `u:${uid}`, uid, plan, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
const post = async (h: typeof meHandler, t: string | null, body?: unknown) => h(new Request("https://ai.example/x", { method: "POST", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

describe("/me", () => {
  it("anon token → plan anon only", async () => {
    const t = await signSession({ vid: "x", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    expect(await (await post(meHandler, t)).json()).toEqual({ plan: "anon", paywall: false });
  });
  it("user → plan, trial end, terms state, zero usage", async () => {
    await ensureUser(env.DB, "user_me1", "m@x.y", Math.floor(Date.now() / 1000));
    const body = (await (await post(meHandler, await tok("user_me1"))).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ plan: "trial", termsAccepted: false, termsVersion: TERMS_VERSION, usage: { aiDay: 0, aiMonth: 0, voiceDaySec: 0, voiceMonthSec: 0, ocrMonth: 0 } });
  });
  it("401 without a token", async () => { expect((await post(meHandler, null)).status).toBe(401); });
});
describe("/terms/accept", () => {
  it("stores the current version, rejects others", async () => {
    await ensureUser(env.DB, "user_t1", "t@x.y", 1);
    expect((await post(termsHandler, await tok("user_t1"), { version: "old" })).status).toBe(400);
    expect((await post(termsHandler, await tok("user_t1"), { version: TERMS_VERSION })).status).toBe(200);
    expect((await getUser(env.DB, "user_t1"))?.terms_version).toBe(TERMS_VERSION);
  });
});
describe("/account/delete", () => {
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
