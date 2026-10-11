import type { Env } from "./env";

/** ALLOWED_ORIGIN may be a comma-separated list; return the entry matching the request's Origin, else the first. */
export function resolveOrigin(env: Env, request: Request): string {
  const allowed = env.ALLOWED_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  const origin = request.headers.get("origin");
  return origin && allowed.includes(origin) ? origin : allowed[0] ?? "";
}

export function corsHeaders(env: Env): Record<string, string> {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN.split(",")[0].trim(),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export function json(body: unknown, status: number, env: Env, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(env), ...extra },
  });
}
