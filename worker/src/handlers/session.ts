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
    const token = await signSession({ vid: `u:${claims.sub}`, uid: claims.sub, plan, exp }, env.SESSION_SECRET);
    return json({ token, expiresAt: exp, plan }, 200, env);
  }
  let token = "";
  try {
    const body = (await request.json()) as { turnstileToken?: unknown };
    if (typeof body.turnstileToken === "string") token = body.turnstileToken;
  } catch { /* fall through */ }
  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  if (!(await verifyTurnstile(token, ip, env))) return json({ error: "verification_failed" }, 403, env);
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(now + 24 * 3600, nextUtcMidnight(now));
  const vid = await visitorId(ip, env.SESSION_SECRET, utcDay(now));
  return json({ token: await signSession({ vid, exp }, env.SESSION_SECRET), expiresAt: exp, plan: "anon" }, 200, env);
}
