import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { checkoutHandler, portalHandler, configureBillingDeps } from "../src/handlers/billing";
import { setStripeFetch } from "../src/stripe";
import { signSession } from "../src/session";
import { ensureUser, getUser } from "../src/users";

const calls: { url: string; body: string }[] = [];
const fakeStripe: typeof fetch = async (input, init) => {
  const url = String(input), body = String(init?.body ?? "");
  calls.push({ url, body });
  if (url.endsWith("/v1/customers")) return Response.json({ id: "cus_new" });
  if (url.endsWith("/v1/checkout/sessions")) return Response.json({ url: "https://checkout.stripe.test/s" });
  if (url.endsWith("/v1/billing_portal/sessions")) return Response.json({ url: "https://billing.stripe.test/p" });
  return new Response("{}", { status: 404 });
};
const tok = (uid: string) => signSession({ vid: `u:${uid}`, uid, plan: "trial", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
const post = async (h: typeof checkoutHandler, t: string, body?: unknown) => h(new Request("https://ai.example/b", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }), env);

beforeEach(() => { calls.length = 0; configureBillingDeps({ fetch: fakeStripe }); });
afterEach(() => { setStripeFetch((i, init) => fetch(i, init)); });

describe("/billing/checkout", () => {
  it("creates a customer once, then a subscription checkout with the server-side price", async () => {
    await ensureUser(env.DB, "user_b1", "b@x.y", 1);
    const res = await post(checkoutHandler, await tok("user_b1"), { interval: "year" });
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    expect((await getUser(env.DB, "user_b1"))?.stripe_customer_id).toBe("cus_new");
    const co = calls.find((c) => c.url.endsWith("/checkout/sessions"))!;
    const form = new URLSearchParams(co.body);
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("line_items[0][price]")).toBe("price_year");
    expect(form.get("client_reference_id")).toBe("user_b1");
    expect(form.get("customer")).toBe("cus_new");
    expect(form.get("success_url")).toBe("http://localhost:5173/?checkout=success");
    await post(checkoutHandler, await tok("user_b1"), { interval: "month" });
    expect(calls.filter((c) => c.url.endsWith("/v1/customers")).length).toBe(1);
  });
  it("409 already_subscribed for a user who is already Pro, without calling Stripe", async () => {
    await ensureUser(env.DB, "user_b9", "b@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_b9', subscription_status='active', current_period_end=? WHERE id='user_b9'").bind(Math.floor(Date.now() / 1000) + 86400 * 20).run();
    const res = await post(checkoutHandler, await tok("user_b9"), { interval: "month" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_subscribed" });
    expect(calls).toHaveLength(0);
    // Cancel-at-period-end (stored "canceled" with a future period end) is still Pro: no second subscription.
    await env.DB.prepare("UPDATE users SET subscription_status='canceled' WHERE id='user_b9'").run();
    expect((await post(checkoutHandler, await tok("user_b9"), { interval: "year" })).status).toBe(409);
    // Once the paid period is over, checkout is allowed again.
    await env.DB.prepare("UPDATE users SET current_period_end=? WHERE id='user_b9'").bind(Math.floor(Date.now() / 1000) - 10).run();
    expect((await post(checkoutHandler, await tok("user_b9"), { interval: "year" })).status).toBe(200);
  });
  it("400 for an unknown interval; 401 for anon", async () => {
    await ensureUser(env.DB, "user_b2", "b@x.y", 1);
    expect((await post(checkoutHandler, await tok("user_b2"), { interval: "week" })).status).toBe(400);
    const anon = await signSession({ vid: "a", exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    expect((await post(checkoutHandler, anon, { interval: "month" })).status).toBe(401);
  });
});
describe("/billing/portal", () => {
  it("returns a portal url for a customer; 409 without one", async () => {
    await ensureUser(env.DB, "user_b3", "b@x.y", 1);
    expect((await post(portalHandler, await tok("user_b3"))).status).toBe(409);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_3' WHERE id='user_b3'").run();
    expect(await (await post(portalHandler, await tok("user_b3"))).json()).toEqual({ url: "https://billing.stripe.test/p" });
  });
});
