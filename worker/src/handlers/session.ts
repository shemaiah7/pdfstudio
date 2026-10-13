import type { Env } from "../env";
import { json } from "../cors";
import { verifyTurnstile } from "../turnstile";
import { signSession, utcDay, visitorId } from "../session";
import { nextUtcMidnight } from "../quota";

const enc = new TextEncoder();

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** Constant-time check of the supplied key against the OWNER_KEY secret (both hashed to equal length first). */
async function isOwnerKey(supplied: string, env: Env): Promise<boolean> {
  const secret = env.OWNER_KEY;
  if (typeof secret !== "string" || secret.length < 32) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sessionHandler(request: Request, env: Env): Promise<Response> {
  let token = "";
  let ownerKey = "";
  try {
    const body = (await request.json()) as { turnstileToken?: unknown; ownerKey?: unknown };
    if (typeof body.turnstileToken === "string") token = body.turnstileToken;
    if (typeof body.ownerKey === "string") ownerKey = body.ownerKey;
  } catch { /* fall through */ }
  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  if (!(await verifyTurnstile(token, ip, env))) return json({ error: "verification_failed" }, 403, env);
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(now + 24 * 3600, nextUtcMidnight(now));
  const vid = await visitorId(ip, env.SESSION_SECRET, utcDay(now));
  const owner = await isOwnerKey(ownerKey, env);
  const payload = owner ? { vid, exp, owner: true as const } : { vid, exp };
  return json({ token: await signSession(payload, env.SESSION_SECRET), expiresAt: exp, ...(owner ? { owner: true } : {}) }, 200, env);
}
