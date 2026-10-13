// worker/src/stripe.ts
import type { Env } from "./env";

const API = "https://api.stripe.com/v1";
export const STRIPE_VERSION = "2025-03-31.basil";
let stripeFetchImpl: typeof fetch = (i, init) => fetch(i, init);
export function setStripeFetch(f: typeof fetch): void { stripeFetchImpl = f; }

/** Minimal Stripe REST client: form-encoded bodies, bearer secret key. */
export async function stripeFetch<T = Record<string, unknown>>(path: string, env: Env, form?: Record<string, string>, method: "GET" | "POST" | "DELETE" = form ? "POST" : "GET"): Promise<T> {
  const res = await stripeFetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_VERSION, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (!res.ok) throw new Error(`stripe_${res.status}`);
  return (await res.json()) as T;
}

export async function cancelCustomerSubscriptions(customerId: string, env: Env): Promise<void> {
  const subs = await stripeFetch<{ data: { id: string; status: string }[] }>(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`, env);
  for (const s of subs.data) if (s.status !== "canceled" && s.status !== "incomplete_expired") await stripeFetch(`/subscriptions/${s.id}`, env, undefined, "DELETE");
}

export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000), toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const t = Number(parts.t), v1 = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(t) || v1.length === 0 || Math.abs(now - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time compare against any v1
  return v1.some((sig) => sig.length === mac.length && [...sig].reduce((d, c, i) => d | (c.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}
