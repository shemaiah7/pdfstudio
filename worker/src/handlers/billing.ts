// worker/src/handlers/billing.ts
import type { Env } from "../env";
import { json } from "../cors";
import { verifySession } from "../session";
import { getUser, getUserByCustomer, updateUser } from "../users";
import { stripeFetch, setStripeFetch, verifyStripeSignature } from "../stripe";
import { planOf } from "../plan";

export function configureBillingDeps(p: { fetch?: typeof fetch }): void { if (p.fetch) setStripeFetch(p.fetch); }

async function user(request: Request, env: Env) {
  const a = request.headers.get("authorization") ?? "";
  const s = a.startsWith("Bearer ") ? await verifySession(a.slice(7), env.SESSION_SECRET) : null;
  if (!s?.uid) return null;
  return getUser(env.DB, s.uid);
}

export async function checkoutHandler(request: Request, env: Env): Promise<Response> {
  let u;
  try { u = await user(request, env); } catch { return json({ error: "account_unavailable" }, 503, env); }
  if (!u) return json({ error: "unauthorized" }, 401, env);
  // A second checkout would start a second subscription; Pro users (including cancel-at-period-end and grace) use the portal.
  if (planOf(u, Date.now() / 1000) === "pro") return json({ error: "already_subscribed" }, 409, env);
  let interval: unknown;
  try { interval = ((await request.json()) as { interval?: unknown }).interval; } catch { /* invalid */ }
  const price = interval === "month" ? env.STRIPE_PRICE_MONTHLY : interval === "year" ? env.STRIPE_PRICE_YEARLY : null;
  if (!price) return json({ error: "invalid_interval" }, 400, env);
  try {
    let customer = u.stripe_customer_id;
    if (!customer) {
      customer = (await stripeFetch<{ id: string }>("/customers", env, { email: u.email, "metadata[clerk_user_id]": u.id })).id;
      await updateUser(env.DB, u.id, { stripe_customer_id: customer });
    }
    const app = env.APP_URL.replace(/\/$/, "");
    const session = await stripeFetch<{ url: string }>("/checkout/sessions", env, {
      mode: "subscription", customer, client_reference_id: u.id,
      "line_items[0][price]": price, "line_items[0][quantity]": "1",
      success_url: `${app}/?checkout=success`, cancel_url: `${app}/?checkout=cancel`,
      allow_promotion_codes: "true",
    });
    return json({ url: session.url }, 200, env);
  } catch { return json({ error: "billing_unavailable" }, 502, env); }
}

export async function portalHandler(request: Request, env: Env): Promise<Response> {
  let u;
  try { u = await user(request, env); } catch { return json({ error: "account_unavailable" }, 503, env); }
  if (!u) return json({ error: "unauthorized" }, 401, env);
  if (!u.stripe_customer_id) return json({ error: "no_customer" }, 409, env);
  try {
    const p = await stripeFetch<{ url: string }>("/billing_portal/sessions", env, { customer: u.stripe_customer_id, return_url: env.APP_URL });
    return json({ url: p.url }, 200, env);
  } catch { return json({ error: "billing_unavailable" }, 502, env); }
}

type Sub = { id: string; status: string; cancel_at_period_end?: boolean; current_period_end?: number; items?: { data: { current_period_end?: number }[] }; customer: string; ended_at?: number | null };

async function applySubscription(env: Env, subId: string, deleted = false): Promise<void> {
  const s = await stripeFetch<Sub>(`/subscriptions/${encodeURIComponent(subId)}`, env);
  const u = await getUserByCustomer(env.DB, s.customer);
  if (!u) return;
  // Cancelled in the portal but paid to period end: Stripe keeps "active", we store "canceled" so the app says "Ends" (planOf keeps Pro until then).
  const raw = deleted ? "canceled" : s.status;
  const ending = s.cancel_at_period_end === true && (raw === "active" || raw === "trialing");
  const status = ending ? "canceled" : raw;
  const now = Math.floor(Date.now() / 1000);
  const patch: Parameters<typeof updateUser>[2] = { subscription_status: status };
  let periodEnd = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  if (deleted) periodEnd = Math.min(periodEnd ?? Infinity, s.ended_at ?? now);
  if (typeof periodEnd === "number" && Number.isFinite(periodEnd)) patch.current_period_end = periodEnd;
  if (raw === "active" || raw === "trialing") patch.past_due_since = null;
  if ((raw === "past_due" || raw === "unpaid") && u.past_due_since === null) patch.past_due_since = now;
  await updateUser(env.DB, u.id, patch);
}

export async function webhookHandler(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!(await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return new Response("bad signature", { status: 400 });
  let ev: { id: string; type: string; data: { object: Record<string, unknown> } };
  try { ev = JSON.parse(raw); } catch { return new Response("bad payload", { status: 400 }); }
  if (!ev || typeof ev.id !== "string" || !ev.id || typeof ev.type !== "string" || !ev.data || typeof ev.data.object !== "object" || ev.data.object === null) return new Response("bad payload", { status: 400 });
  try {
    const seen = await env.DB.prepare("INSERT INTO stripe_events (id, received_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(ev.id, Math.floor(Date.now() / 1000)).run();
    if (seen.meta.changes === 0) return Response.json({ received: true });
    const o = ev.data.object;
    switch (ev.type) {
      case "checkout.session.completed": {
        const uid = o.client_reference_id as string | null, customer = o.customer as string | null;
        if (uid && customer) await updateUser(env.DB, uid, { stripe_customer_id: customer });
        if (typeof o.subscription === "string") await applySubscription(env, o.subscription);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await applySubscription(env, o.id as string);
        break;
      case "customer.subscription.deleted":
        await applySubscription(env, o.id as string, true);
        break;
      case "invoice.payment_failed": {
        const u = await getUserByCustomer(env.DB, o.customer as string);
        if (u && u.past_due_since === null) await updateUser(env.DB, u.id, { past_due_since: Math.floor(Date.now() / 1000) });
        break;
      }
      case "invoice.paid": {
        const u = await getUserByCustomer(env.DB, o.customer as string);
        if (u) await updateUser(env.DB, u.id, { past_due_since: null });
        break;
      }
    }
  } catch {
    // let Stripe retry: remove the idempotency marker so the retry is processed
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ?").bind(ev.id).run().catch(() => {});
    return new Response("retry", { status: 500 });
  }
  return Response.json({ received: true });
}
