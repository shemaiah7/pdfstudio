import type { Env } from "../env";
import { json } from "../cors";
import { verifySession } from "../session";
import { validateAiBody } from "../validate";
import { buildRequest } from "../request";
import { checkQuota, recordTokens, DAILY_REQUESTS, DAILY_TOKENS, type QuotaState } from "../quota";
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
  const vid = session.vid;
  let recorded: Promise<QuotaState> | undefined;
  const record = (u: { inputTokens: number; outputTokens: number }) =>
    (recorded ??= recordTokens(env.QUOTA, vid, day, u.inputTokens + u.outputTokens));
  let finished!: () => void;
  ctx.waitUntil(new Promise<void>((resolve) => { finished = resolve; }));

  return sseResponse(env, async (send, signal) => {
    const aborted = new Promise<"aborted">((resolve) => signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
    try {
      const it = result.events[Symbol.asyncIterator]();
      try {
        for (;;) {
          const next = it.next();
          next.catch(() => {});
          const r = await Promise.race([next, aborted]);
          if (r === "aborted") {
            result.abort?.();
            void Promise.resolve(it.return?.()).catch(() => {});
            console.log(JSON.stringify({ task: v.body.task, vid, status: "client_disconnected" }));
            return;
          }
          if (r.done) break;
          send("delta", { text: r.value.text });
        }
      } catch (err) {
        const kind = mapError(err);
        console.log(JSON.stringify({ task: v.body.task, vid, status: "error", kind }));
        send("error", { error: kind });
        return;
      }
      const f = await result.final();
      const state = await record(f);
      console.log(JSON.stringify({ task: v.body.task, vid, status: f.stop, tokens: f.inputTokens + f.outputTokens }));
      if (f.stop === "refusal") { send("error", { error: "refused" }); return; }
      send("done", {
        usage: { input: f.inputTokens, output: f.outputTokens },
        stop: f.stop,
        remaining: { requests: Math.max(0, DAILY_REQUESTS - state.requests), tokens: Math.max(0, DAILY_TOKENS - state.tokens) },
        resetAt,
      });
    } finally {
      // Runs on every exit path (completion, error, client disconnect): charge whatever was consumed.
      const p = record(result.usageSoFar()).catch(() => undefined);
      ctx.waitUntil(p);
      await p;
      finished();
    }
  });
}
