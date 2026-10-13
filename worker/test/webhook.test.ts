// worker/test/webhook.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { webhookHandler, configureBillingDeps } from "../src/handlers/billing";
import { verifyStripeSignature } from "../src/stripe";
import { ensureUser, getUser } from "../src/users";

async function sign(body: string, secret = env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
let sub = { id: "sub_1", status: "active", current_period_end: 2_000_000_000, customer: "cus_w1" };
const fake: typeof fetch = async (input) => String(input).includes("/subscriptions/") ? Response.json(sub) : new Response("{}", { status: 404 });
const send = async (event: unknown, sig?: string) => {
  const body = JSON.stringify(event);
  return webhookHandler(new Request("https://ai.example/billing/webhook", { method: "POST", headers: { "stripe-signature": sig ?? (await sign(body)) }, body }), env);
};
beforeEach(() => { configureBillingDeps({ fetch: fake }); sub = { id: "sub_1", status: "active", current_period_end: 2_000_000_000, customer: "cus_w1" }; });
afterEach(() => { configureBillingDeps({ fetch: (i, init) => fetch(i, init) }); });

describe("verifyStripeSignature", () => {
  it("valid / tampered / stale", async () => {
    const body = '{"a":1}';
    expect(await verifyStripeSignature(body, await sign(body), env.STRIPE_WEBHOOK_SECRET)).toBe(true);
    expect(await verifyStripeSignature('{"a":2}', await sign(body), env.STRIPE_WEBHOOK_SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, await sign(body, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 1000), env.STRIPE_WEBHOOK_SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, null, env.STRIPE_WEBHOOK_SECRET)).toBe(false);
  });
});

describe("/billing/webhook", () => {
  it("400 on bad signature", async () => { expect((await send({ id: "evt_x", type: "x" }, "t=1,v1=00")).status).toBe(400); });
  it("checkout.session.completed links the customer via client_reference_id and applies the subscription", async () => {
    await ensureUser(env.DB, "user_w1", "w@x.y", 1);
    const r = await send({ id: "evt_1", type: "checkout.session.completed", data: { object: { client_reference_id: "user_w1", customer: "cus_w1", subscription: "sub_1" } } });
    expect(r.status).toBe(200);
    expect(await getUser(env.DB, "user_w1")).toMatchObject({ stripe_customer_id: "cus_w1", subscription_status: "active", current_period_end: 2_000_000_000 });
  });
  it("duplicate event id is applied once", async () => {
    await ensureUser(env.DB, "user_w2", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w2' WHERE id='user_w2'").run();
    sub = { ...sub, customer: "cus_w2", status: "past_due" };
    const ev = { id: "evt_dup", type: "invoice.payment_failed", data: { object: { customer: "cus_w2" } } };
    await send(ev);
    const first = (await getUser(env.DB, "user_w2"))!.past_due_since;
    await new Promise((r) => setTimeout(r, 1100));
    expect((await send(ev)).status).toBe(200);
    expect((await getUser(env.DB, "user_w2"))!.past_due_since).toBe(first);
  }, 10_000);
  it("out-of-order: an older 'updated' payload never overwrites the fetched current state", async () => {
    await ensureUser(env.DB, "user_w3", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w3' WHERE id='user_w3'").run();
    sub = { ...sub, customer: "cus_w3", status: "canceled", current_period_end: 1_900_000_000 };
    await send({ id: "evt_old", type: "customer.subscription.updated", data: { object: { ...sub, status: "active" } } });
    expect((await getUser(env.DB, "user_w3"))!.subscription_status).toBe("canceled");
  });
  it("unknown customer without client_reference_id is acknowledged (200) and ignored", async () => {
    sub = { ...sub, customer: "cus_nobody" };
    expect((await send({ id: "evt_n", type: "customer.subscription.updated", data: { object: sub } })).status).toBe(200);
  });
  it("invoice.paid clears past_due_since", async () => {
    await ensureUser(env.DB, "user_w4", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w4', past_due_since=123 WHERE id='user_w4'").run();
    await send({ id: "evt_paid", type: "invoice.paid", data: { object: { customer: "cus_w4" } } });
    expect((await getUser(env.DB, "user_w4"))!.past_due_since).toBeNull();
  });
});
