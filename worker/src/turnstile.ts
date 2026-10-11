import type { Env } from "./env";

export async function verifyTurnstile(token: string, ip: string, env: Env, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  const allowed = new Set(env.TURNSTILE_HOSTNAMES.split(",").map((h) => h.trim()).filter(Boolean));
  try {
    const r = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return false;
    const result = (await r.json()) as { success?: boolean; hostname?: string };
    return result.success === true && typeof result.hostname === "string" && allowed.has(result.hostname);
  } catch {
    return false;
  }
}
