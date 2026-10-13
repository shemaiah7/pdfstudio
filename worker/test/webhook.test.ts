// worker/test/webhook.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { webhookHandler, configureBillingDeps } from "../src/handlers/billing";
import { verifyStripeSignature } from "../src/stripe";
import { ensureUser, getUser } from "../src/users";
import { planOf } from "../src/plan";

async function sign(body: string, secret = env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
let sub: Record<string, unknown> = { id: "sub_1", status: "active", current_period_end: 2_000_000_000, customer: "cus_w1" };
let lastInit: RequestInit | undefined;
let failStripe = false;
const fake: typeof fetch = async (input, init) => { lastInit = init; if (failStripe) return new Response("{}", { status: 500 }); return String(input).includes("/subscriptions/") ? Response.json(sub) : new Response("{}", { status: 404 }); };
const send = async (event: unknown, sig?: string) => {
  const body = JSON.stringify(event);
  return webhookHandler(new Request("https://ai.example/billing/webhook", { method: "POST", headers: { "stripe-signature": sig ?? (await sign(body)) }, body }), env);
};
beforeEach(() => { failStripe = false; configureBillingDeps({ fetch: fake }); sub = { id: "sub_1", status: "active", current_period_end: 2_000_000_000, customer: "cus_w1" }; });
afterEach(() => { configureBillingDeps({ fetch: (i, init) => fetch(i, init) }); });

describe("verifyStripeSignature", () => {
  it("valid / tampered / stale", async () => {
    const body = '{"a":1}';
    expect(await verifyStripeSignature(body, await sign(body), env.STRIPE_WEBHOOK_SECRET)).toBe(true);
    expect(await verifyStripeSignature('{"a":2}', await sign(body), env.STRIPE_WEBHOOK_SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, await sign(body, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 1000), env.STRIPE_WEBHOOK_SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, null, env.STRIPE_WEBHOOK_SECRET)).toBe(false);
    const good = await sign(body);
    expect(await verifyStripeSignature(body, good.replace(",v1=", ",v1=" + "0".repeat(64) + ",v1="), env.STRIPE_WEBHOOK_SECRET)).toBe(true);
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
    sub = { ...sub, customer: "cus_w2", status: "active" };
    const ev = { id: "evt_dup", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } };
    expect((await send(ev)).status).toBe(200);
    expect((await getUser(env.DB, "user_w2"))!.subscription_status).toBe("active");
    sub = { ...sub, status: "canceled" };
    expect((await send(ev)).status).toBe(200);
    expect((await getUser(env.DB, "user_w2"))!.subscription_status).toBe("active");
  });
  it("cancel_at_period_end on an active subscription is stored as canceled, keeping the period end (Pro until then)", async () => {
    await ensureUser(env.DB, "user_w9", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w9' WHERE id='user_w9'").run();
    sub = { id: "sub_9", status: "active", cancel_at_period_end: true, current_period_end: 2_000_000_000, customer: "cus_w9" };
    expect((await send({ id: "evt_cape", type: "customer.subscription.updated", data: { object: { id: "sub_9" } } })).status).toBe(200);
    const u = (await getUser(env.DB, "user_w9"))!;
    expect(u).toMatchObject({ subscription_status: "canceled", current_period_end: 2_000_000_000 });
    expect(planOf(u, 1_999_999_000)).toBe("pro");
    // Resumed in the portal: back to active.
    sub = { ...sub, cancel_at_period_end: false };
    await send({ id: "evt_cape2", type: "customer.subscription.updated", data: { object: { id: "sub_9" } } });
    expect((await getUser(env.DB, "user_w9"))!.subscription_status).toBe("active");
  });
  it("invoice.payment_failed sets past_due_since when null", async () => {
    await ensureUser(env.DB, "user_w5", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w5' WHERE id='user_w5'").run();
    await send({ id: "evt_pf", type: "invoice.payment_failed", data: { object: { customer: "cus_w5" } } });
    expect((await getUser(env.DB, "user_w5"))!.past_due_since).not.toBeNull();
  });
  it("processing failure returns 500 and releases the idempotency marker", async () => {
    await ensureUser(env.DB, "user_w6", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w6' WHERE id='user_w6'").run();
    sub = { ...sub, customer: "cus_w6" };
    const ev = { id: "evt_fail", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } };
    failStripe = true;
    expect((await send(ev)).status).toBe(500);
    expect(await env.DB.prepare("SELECT id FROM stripe_events WHERE id='evt_fail'").first()).toBeNull();
    failStripe = false;
    expect((await send(ev)).status).toBe(200);
    expect((await getUser(env.DB, "user_w6"))!.subscription_status).toBe("active");
  });
  it("malformed JSON or missing id after a valid signature is 400", async () => {
    const bad = "not json";
    expect((await webhookHandler(new Request("https://ai.example/billing/webhook", { method: "POST", headers: { "stripe-signature": await sign(bad) }, body: bad }), env)).status).toBe(400);
    expect((await send({ type: "x", data: { object: {} } })).status).toBe(400);
    expect((await send({ id: 5, type: "x", data: { object: {} } })).status).toBe(400);
  });
  it("sends the pinned Stripe-Version header", async () => {
    await ensureUser(env.DB, "user_w7", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w7' WHERE id='user_w7'").run();
    sub = { ...sub, customer: "cus_w7" };
    await send({ id: "evt_ver", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    expect((lastInit!.headers as Record<string, string>)["Stripe-Version"]).toBe("2025-03-31.basil");
  });
  it("reads period end from items.data[0] (basil shape)", async () => {
    await ensureUser(env.DB, "user_w8", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w8' WHERE id='user_w8'").run();
    sub = { id: "sub_1", status: "active", customer: "cus_w8", items: { data: [{ current_period_end: 1_950_000_000 }] } };
    await send({ id: "evt_basil", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    expect(await getUser(env.DB, "user_w8")).toMatchObject({ subscription_status: "active", current_period_end: 1_950_000_000 });
  });
  it("no period end anywhere leaves the stored value unchanged", async () => {
    await ensureUser(env.DB, "user_w9", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_w9', current_period_end=1700000000 WHERE id='user_w9'").run();
    sub = { id: "sub_1", status: "active", customer: "cus_w9" };
    await send({ id: "evt_nope", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    expect(await getUser(env.DB, "user_w9")).toMatchObject({ subscription_status: "active", current_period_end: 1700000000 });
  });
  it("deleted with ended_at before period end truncates access (free)", async () => {
    const now = Math.floor(Date.now() / 1000);
    await ensureUser(env.DB, "user_d1", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_d1' WHERE id='user_d1'").run();
    sub = { id: "sub_1", status: "canceled", customer: "cus_d1", current_period_end: now + 20 * 86400, ended_at: now - 100 };
    await send({ id: "evt_del1", type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } });
    const u = (await getUser(env.DB, "user_d1"))!;
    expect(u.current_period_end).toBe(now - 100);
    expect(planOf(u, now)).toBe("free");
  });
  it("deleted at period end (cancel-at-period-end) preserves the period end", async () => {
    const now = Math.floor(Date.now() / 1000);
    await ensureUser(env.DB, "user_d2", "w@x.y", 1);
    await env.DB.prepare("UPDATE users SET stripe_customer_id='cus_d2' WHERE id='user_d2'").run();
    sub = { id: "sub_1", status: "canceled", customer: "cus_d2", current_period_end: now - 5, ended_at: now - 5 };
    await send({ id: "evt_del2", type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } });
    expect((await getUser(env.DB, "user_d2"))!.current_period_end).toBe(now - 5);
  });
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
