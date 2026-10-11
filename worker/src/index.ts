import type { Env } from "./env";
import { corsHeaders, json, resolveOrigin } from "./cors";
import { sessionHandler } from "./handlers/session";
import { aiHandler } from "./handlers/ai";
import { ocrHandler } from "./handlers/ocr";

export type Handler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

const routes: Record<string, Handler> = {
  "/session": (r, env) => sessionHandler(r, env),
  "/ai": (r, env, ctx) => aiHandler(r, env, ctx),
  "/ocr": (r, env, ctx) => ocrHandler(r, env, ctx),
};

export default {
  async fetch(request: Request, baseEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env: Env = { ...baseEnv, ALLOWED_ORIGIN: resolveOrigin(baseEnv, request) };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    const { pathname } = new URL(request.url);
    const handler = routes[pathname];
    if (!handler) return json({ error: "not_found" }, 404, env);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, env);
    return handler(request, env, ctx);
  },
};

export function registerRoute(path: string, handler: Handler): void {
  routes[path] = handler;
}
