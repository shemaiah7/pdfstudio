import type { Env } from "../env";
import { json } from "../cors";
import { verifyTurnstile } from "../turnstile";
import { signSession, utcDay, visitorId } from "../session";
import { nextUtcMidnight } from "../quota";

export async function sessionHandler(request: Request, env: Env): Promise<Response> {
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
  return json({ token: await signSession({ vid, exp }, env.SESSION_SECRET), expiresAt: exp }, 200, env);
}
