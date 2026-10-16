import type { Env } from "../env";
import { json } from "../cors";
import { verifyClerkJwt, createSignInToken } from "../clerk";

let fetchFn: typeof fetch = (input, init) => fetch(input, init);
export function configureDesktopTicketFetch(f: typeof fetch): void { fetchFn = f; }

const LIMIT_PER_MINUTE = 5;

export async function desktopTicketHandler(request: Request, env: Env): Promise<Response> {
  if (!env.CLERK_SECRET_KEY || !env.CLERK_ISSUER) return json({ error: "accounts_unavailable" }, 503, env);
  const a = request.headers.get("authorization") ?? "";
  const claims = a.startsWith("Bearer ") ? await verifyClerkJwt(a.slice(7), env).catch(() => null) : null;
  if (!claims) return json({ error: "unauthorized" }, 401, env);
  const key = `dt:${claims.sub}:${Math.floor(Date.now() / 60000)}`;
  const used = Number((await env.QUOTA.get(key)) ?? "0");
  if (used >= LIMIT_PER_MINUTE) return json({ error: "rate_limited" }, 429, env);
  await env.QUOTA.put(key, String(used + 1), { expirationTtl: 120 });
  try {
    const ticket = await createSignInToken(claims.sub, env, fetchFn);
    return json({ ticket }, 200, env, { "cache-control": "no-store" });
  } catch {
    return json({ error: "upstream" }, 502, env);
  }
}
