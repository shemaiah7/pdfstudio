import type { Env } from "../env";
import { json } from "../cors";
import { verifySession } from "../session";
import { gateFor, checkUsage, TOKEN_DAY } from "../limits";
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
  if (declared > 2_500_000) return json({ error: "document_too_large", maxChars: 600000 }, 413, env);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "invalid_body" }, 400, env); }
  const v = validateAiBody(raw);
  if (!v.ok) return json({ error: v.error, ...(v.maxChars ? { maxChars: v.maxChars } : {}) }, v.status, env);

  const b = v.body;
  const chars =
    b.document.reduce((n, p) => n + p.text.length, 0) +
    (b.task === "rewrite" ? b.selection.length : 0) +
    (b.task === "ask" ? b.question.length : 0);
  const estimate = Math.ceil(chars / 3.5);
  const now = Date.now() / 1000;
  const gate = await gateFor(env, session, now);
  if (gate === "account_required") return json({ error: "account_required" }, 403, env);
  if (gate === "account_unavailable") return json({ error: "account_unavailable" }, 503, env);
  let quota;
  if (gate) {
    const u = await checkUsage(env.QUOTA, session.vid, gate.plan, "ai", 1, gate.month, now, estimate);
    if (!u.ok) return json({ error: u.error, resetAt: u.resetAt, ...(u.scope ? { scope: u.scope } : {}) }, u.error === "pro_required" ? 403 : 429, env);
    quota = u;
  } else {
    quota = await checkQuota(env.QUOTA, session.vid, now, estimate);
    if (!quota.ok) return json({ error: quota.reason, resetAt: quota.resetAt }, 429, env);
  }

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
  // Admission already charged `estimate`; only write the (rare) excess, and skip the write otherwise.
  const record = (u: { inputTokens: number; outputTokens: number }) =>
    (recorded ??= (async () => {
      const delta = Math.max(0, u.inputTokens + u.outputTokens - estimate);
      return delta === 0 ? quota.charged : recordTokens(env.QUOTA, vid, day, delta);
    })());
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
        remaining: gate
          ? { requests: quota.remaining.requests, tokens: Math.max(0, TOKEN_DAY[gate.plan] - state.tokens) }
          : { requests: Math.max(0, DAILY_REQUESTS - state.requests), tokens: Math.max(0, DAILY_TOKENS - state.tokens) },
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
