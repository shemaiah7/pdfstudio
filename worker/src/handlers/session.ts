import type { Env } from "../env";
import { json } from "../cors";
import { verifyTurnstile } from "../turnstile";
import { signSession, utcDay, visitorId } from "../session";
import { nextUtcMidnight } from "../quota";
import { verifyClerkJwt, clerkUserEmail } from "../clerk";
import { ensureUser, getUser } from "../users";
import { planOf } from "../plan";

export interface SessionDeps { userEmail(id: string, env: Env): Promise<string> }
const deps: SessionDeps = { userEmail: (id, env) => clerkUserEmail(id, env) };
export function configureSessionDeps(p: Partial<SessionDeps>): void { Object.assign(deps, p); }
export const USER_SESSION_SECONDS = 600;

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
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const claims = await verifyClerkJwt(auth.slice(7), env);
    if (!claims) return json({ error: "unauthorized" }, 401, env);
    const now = Math.floor(Date.now() / 1000);
    let user;
    try {
      user = await getUser(env.DB, claims.sub);
      if (!user) user = await ensureUser(env.DB, claims.sub, await deps.userEmail(claims.sub, env), now);
    } catch { return json({ error: "account_unavailable" }, 503, env); }
    const plan = planOf(user, now);
    const exp = now + USER_SESSION_SECONDS;
    let ownerKey = "";
    try {
      const body = (await request.json()) as { ownerKey?: unknown };
      if (typeof body?.ownerKey === "string") ownerKey = body.ownerKey;
    } catch { /* no body */ }
    const owner = await isOwnerKey(ownerKey, env);
    const payload = { vid: `u:${claims.sub}`, uid: claims.sub, plan, exp, ...(owner ? { owner: true as const } : {}) };
    const token = await signSession(payload, env.SESSION_SECRET);
    return json({ token, expiresAt: exp, plan, ...(owner ? { owner: true } : {}) }, 200, env);
  }
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
  return json({ token: await signSession(payload, env.SESSION_SECRET), expiresAt: exp, plan: "anon", ...(owner ? { owner: true } : {}) }, 200, env);
}
