// worker/src/handlers/billing.ts
import type { Env } from "../env";
import { json } from "../cors";
import { verifySession } from "../session";
import { getUser, updateUser } from "../users";
import { stripeFetch, setStripeFetch } from "../stripe";

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
