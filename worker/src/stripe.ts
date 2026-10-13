// worker/src/stripe.ts
import type { Env } from "./env";

const API = "https://api.stripe.com/v1";
let stripeFetchImpl: typeof fetch = (i, init) => fetch(i, init);
export function setStripeFetch(f: typeof fetch): void { stripeFetchImpl = f; }

/** Minimal Stripe REST client: form-encoded bodies, bearer secret key. */
export async function stripeFetch<T = Record<string, unknown>>(path: string, env: Env, form?: Record<string, string>, method: "GET" | "POST" | "DELETE" = form ? "POST" : "GET"): Promise<T> {
  const res = await stripeFetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (!res.ok) throw new Error(`stripe_${res.status}`);
  return (await res.json()) as T;
}

export async function cancelCustomerSubscriptions(customerId: string, env: Env): Promise<void> {
  const subs = await stripeFetch<{ data: { id: string; status: string }[] }>(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`, env);
  for (const s of subs.data) if (s.status !== "canceled" && s.status !== "incomplete_expired") await stripeFetch(`/subscriptions/${s.id}`, env, undefined, "DELETE");
}
