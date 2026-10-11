import type { Env } from "../env";
import { json } from "../cors";
import { verifySession } from "../session";
import { validateAiBody } from "../validate";
import { buildRequest } from "../request";
import { checkQuota, recordUsage, DAILY_REQUESTS, DAILY_TOKENS } from "../quota";
import { streamWithSdk, mapError, type StreamFn } from "../claude";
import { sseResponse } from "../sse";

export async function aiHandler(request: Request, env: Env, ctx: ExecutionContext, stream: StreamFn = streamWithSdk): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = token ? await verifySession(token, env.SESSION_SECRET) : null;
  if (!session) return json({ error: "unauthorized" }, 401, env);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 1_000_000) return json({ error: "document_too_large", maxChars: 600000 }, 413, env);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "invalid_body" }, 400, env); }
  const v = validateAiBody(raw);
  if (!v.ok) return json({ error: v.error, ...(v.maxChars ? { maxChars: v.maxChars } : {}) }, v.status, env);

  const quota = await checkQuota(env.QUOTA, session.vid);
  if (!quota.ok) return json({ error: quota.reason, resetAt: quota.resetAt }, 429, env);

  let result;
  try {
    result = await stream(buildRequest(v.body), env);
  } catch (err) {
    const kind = mapError(err);
    console.log(JSON.stringify({ task: v.body.task, vid: session.vid, status: "error", kind }));
    return json({ error: kind }, kind === "busy" ? 503 : 502, env);
  }

  const { day, resetAt } = quota;
  return sseResponse(env, async (send) => {
    try {
      for await (const e of result.events) send("delta", { text: e.text });
    } catch {
      send("error", { error: "upstream" });
      return;
    }
    const f = await result.final();
    const tokens = f.inputTokens + f.outputTokens;
    const state = await recordUsage(env.QUOTA, session.vid, day, tokens);
    console.log(JSON.stringify({ task: v.body.task, vid: session.vid, status: f.stop, tokens }));
    if (f.stop === "refusal") { send("error", { error: "refused" }); return; }
    send("done", {
      usage: { input: f.inputTokens, output: f.outputTokens },
      stop: f.stop,
      remaining: { requests: Math.max(0, DAILY_REQUESTS - state.requests), tokens: Math.max(0, DAILY_TOKENS - state.tokens) },
      resetAt,
    });
  });
}
