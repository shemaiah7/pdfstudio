import type { Env } from "../env";
import { json } from "../cors";
import { verifySession } from "../session";
import { validateOcrBody, OCR_MAX_PAGES } from "../validate";
import { checkQuota, recordTokens, DAILY_REQUESTS, DAILY_TOKENS, BURST_REQUESTS } from "../quota";
import { ocrWithSdk, mapError, type OcrFn } from "../claude";

const TOKENS_PER_PAGE = 1_600; // ~1568px JPEG

export async function ocrHandler(request: Request, env: Env, ctx: ExecutionContext, ocr: OcrFn = ocrWithSdk): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = token ? await verifySession(token, env.SESSION_SECRET) : null;
  if (!session) return json({ error: "unauthorized" }, 401, env);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 60_000_000) return json({ error: "image_too_large" }, 413, env);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "invalid_body" }, 400, env); }
  const v = validateOcrBody(raw);
  if (!v.ok) return json({ error: v.error }, v.status, env);

  const pages = v.body.pages;
  const now = Date.now() / 1000;
  const burstLimit = BURST_REQUESTS + OCR_MAX_PAGES;
  // Each page is one AI request: admit the batch only if every page fits today's quota.
  let quota = await checkQuota(env.QUOTA, session.vid, now, TOKENS_PER_PAGE, burstLimit);
  if (!quota.ok) return json({ error: quota.reason, resetAt: quota.resetAt }, 429, env);
  if (quota.charged.requests + pages.length - 1 > DAILY_REQUESTS) return json({ error: "daily_limit", resetAt: quota.resetAt }, 429, env);
  for (let i = 1; i < pages.length; i++) {
    const q = await checkQuota(env.QUOTA, session.vid, now, TOKENS_PER_PAGE, burstLimit);
    if (!q.ok) return json({ error: q.reason, resetAt: q.resetAt }, 429, env);
    quota = q;
  }

  const out: { page: number; lines: string[] }[] = [];
  const failed: number[] = [];
  let extra = 0;
  for (const p of pages) {
    try {
      const r = await ocr(p.image, env);
      out.push({ page: p.page, lines: r.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0) });
      extra += Math.max(0, r.inputTokens + r.outputTokens - TOKENS_PER_PAGE);
    } catch (err) {
      console.log(JSON.stringify({ task: "ocr", vid: session.vid, page: p.page, status: "error", kind: mapError(err) }));
      failed.push(p.page);
    }
  }
  const state = extra > 0 ? await recordTokens(env.QUOTA, session.vid, quota.day, extra) : quota.charged;
  console.log(JSON.stringify({ task: "ocr", vid: session.vid, pages: pages.length, failed: failed.length }));
  return json({ pages: out, failed, remaining: { requests: Math.max(0, DAILY_REQUESTS - state.requests), tokens: Math.max(0, DAILY_TOKENS - state.tokens) }, resetAt: quota.resetAt }, 200, env);
}
