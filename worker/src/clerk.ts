import type { Env } from "./env";

const JWKS_TTL_S = 10 * 60;
const REFETCH_MIN_S = 60; // an unknown kid (key rotation) refetches the JWKS at most this often
let jwksCache: { keys: JsonWebKey[]; at: number } | null = null;
let lastRefetch = -Infinity;
let jwksOverride: JsonWebKey[] | null = null;
export function setJwksForTest(keys: JsonWebKey[] | null): void { jwksOverride = keys; jwksCache = null; lastRefetch = -Infinity; }
const trimSlash = (s: string) => s.replace(/\/+$/, "");

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(fromB64u(s))) as Record<string, unknown>;

async function jwks(env: Env, fetchFn: typeof fetch, now: number, refetch = false): Promise<JsonWebKey[]> {
  if (jwksOverride) return jwksOverride;
  if (jwksCache && now - jwksCache.at < JWKS_TTL_S && !refetch) return jwksCache.keys;
  if (refetch) lastRefetch = now;
  try {
    const res = await fetchFn(`${trimSlash(env.CLERK_ISSUER)}/.well-known/jwks.json`);
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { keys: JsonWebKey[] };
    jwksCache = { keys: body.keys, at: now };
  } catch {
    if (!jwksCache) return []; // no keys yet: every token fails
    // keep serving the stale cache on fetch failure (spec: Error handling)
  }
  return jwksCache!.keys;
}

/** Verifies a Clerk session JWT (RS256 only). Returns the Clerk user id, or null. */
export async function verifyClerkJwt(token: string, env: Env, now = Date.now() / 1000, fetchFn: typeof fetch = fetch): Promise<{ sub: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !env.CLERK_ISSUER) return null;
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = json(parts[0]); payload = json(parts[1]); } catch { return null; }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
  const byKid = (keys: JsonWebKey[]) => keys.find((k) => (k as { kid?: string }).kid === header.kid);
  let jwk = byKid(await jwks(env, fetchFn, now));
  // Unknown kid with a fresh cache: Clerk may have rotated keys, so refetch once (rate-limited).
  if (!jwk && !jwksOverride && now - lastRefetch >= REFETCH_MIN_S) jwk = byKid(await jwks(env, fetchFn, now, true));
  if (!jwk) return null;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { return null; }
  if (!ok) return null;
  const skew = 5;
  if (typeof payload.iss !== "string" || trimSlash(payload.iss) !== trimSlash(env.CLERK_ISSUER)) return null;
  if (typeof payload.exp !== "number" || payload.exp + skew <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf - skew > now) return null;
  if (typeof payload.sub !== "string" || !payload.sub.startsWith("user_")) return null;
  if (typeof payload.azp === "string") {
    const allowed = env.ALLOWED_ORIGIN.split(",").map((o) => o.trim());
    if (!allowed.includes(payload.azp)) return null;
  }
  return { sub: payload.sub };
}

const CLERK_API = "https://api.clerk.com/v1";
export async function clerkUserEmail(id: string, env: Env, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${CLERK_API}/users/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` } });
  if (!res.ok) throw new Error(`clerk_${res.status}`);
  const u = (await res.json()) as { primary_email_address_id?: string; email_addresses?: { id: string; email_address: string }[] };
  return u.email_addresses?.find((e) => e.id === u.primary_email_address_id)?.email_address ?? u.email_addresses?.[0]?.email_address ?? "";
}
export async function deleteClerkUser(id: string, env: Env, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`${CLERK_API}/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` } });
  if (!res.ok && res.status !== 404) throw new Error(`clerk_${res.status}`);
}

/** One-time sign-in token (Clerk Backend API) for the desktop browser hand-off. Valid 300 s, single use. */
export async function createSignInToken(userId: string, env: Env, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${CLERK_API}/sign_in_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
  });
  if (!res.ok) throw new Error(`clerk_${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("clerk_no_token");
  return body.token;
}
