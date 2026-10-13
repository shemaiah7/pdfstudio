import type { Env } from "./env";
import { paywallOn, type Plan } from "./plan";
import { sessionPlan, utcDay, type SessionPayload } from "./session";
import { nextUtcMidnight, type QuotaState } from "./quota";
import { readVoice } from "./voiceQuota";
import { getUser } from "./users";

type Paid = Exclude<Plan, "anon">;
export const LIMITS: Record<Paid, { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number; edit: boolean }> = {
  free: { aiDay: 5, aiMonth: 5 * 31, voiceDaySec: 300, voiceMonthSec: 300 * 31, ocrMonth: 0, edit: false },
  trial: { aiDay: 100, aiMonth: 1000, voiceDaySec: 1800, voiceMonthSec: 7200, ocrMonth: 300, edit: true },
  pro: { aiDay: 100, aiMonth: 1000, voiceDaySec: 1800, voiceMonthSec: 7200, ocrMonth: 300, edit: true },
};

/** Per-plan daily token ceiling and per-minute request burst for gated /ai and /ocr (cost guard, like the anonymous quota). */
export const TOKEN_DAY: Record<Paid, number> = { free: 100_000, trial: 1_000_000, pro: 2_000_000 };
export const GATED_BURST = 10;

export interface MonthWindow { key: string; resetAt: number }

/** `base` moved by `months` whole months, keeping its day of month (clamped to the month's length) and time of day. */
function addMonths(base: number, months: number): number {
  const d = new Date(base * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000;
}

/**
 * The month window usage counts against. Pro: monthly steps anchored on the billing period end (so a yearly
 * subscription still gets a fresh allowance every month); otherwise the UTC calendar month.
 */
export function monthWindow(plan: Plan, periodEnd: number | null, now: number): MonthWindow {
  if (plan === "pro" && periodEnd) {
    let k = 0;
    for (let i = 0; i < 48 && addMonths(periodEnd, k) > now; i++) k--;
    for (let i = 0; i < 48 && addMonths(periodEnd, k + 1) <= now; i++) k++;
    return { key: `p${addMonths(periodEnd, k)}`, resetAt: addMonths(periodEnd, k + 1) };
  }
  const d = new Date(now * 1000);
  return { key: d.toISOString().slice(0, 7), resetAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000 };
}
export function monthKey(plan: Plan, periodEnd: number | null, now: number): string { return monthWindow(plan, periodEnd, now).key; }
const num = async (kv: KVNamespace, k: string) => Number((await kv.get(k)) ?? "0");
const TTL = 40 * 86400;

export type UsageCheck =
  | { ok: true; resetAt: number; day: string; charged: QuotaState; remaining: { requests: number; tokens: number } }
  | { ok: false; error: "daily_limit" | "monthly_limit" | "pro_required" | "too_fast"; resetAt: number; scope?: "day" | "month" };

/**
 * Admits one gated /ai or /ocr call: plan day/month request caps, the daily token ceiling and the burst limit.
 * Charges the request(s) and the input-token estimate on success; the handler reconciles tokens with `recordTokens`.
 */
export async function checkUsage(kv: KVNamespace, sub: string, plan: Paid, kind: "ai" | "ocr", weight: number, month: MonthWindow, now: number, estimateTokens = 0): Promise<UsageCheck> {
  const L = LIMITS[plan];
  const dayCap = kind === "ai" ? L.aiDay : Infinity;
  const monthCap = kind === "ai" ? L.aiMonth : L.ocrMonth;
  if (monthCap === 0) return { ok: false, error: "pro_required", resetAt: 0, scope: "month" };
  const day = utcDay(now), minute = Math.floor(now / 60);
  const dKey = `d:${kind}:${sub}:${day}`, mKey = `m:${kind}:${sub}:${month.key}`, qKey = `q:${sub}:${day}`, bKey = `b:${sub}:${minute}`;
  const [d, m, q] = await Promise.all([num(kv, dKey), num(kv, mKey), kv.get<QuotaState>(qKey, "json")]);
  const tokens = q?.tokens ?? 0;
  if (m + weight > monthCap) return { ok: false, error: "monthly_limit", resetAt: month.resetAt, scope: "month" };
  if (d + weight > dayCap || tokens >= TOKEN_DAY[plan]) return { ok: false, error: "daily_limit", resetAt: nextUtcMidnight(now), scope: "day" };
  const burst = await num(kv, bKey);
  const tooFast = { ok: false as const, error: "too_fast" as const, resetAt: (minute + 1) * 60 };
  if (burst >= GATED_BURST) return tooFast;
  // KV limits same-key writes (~1/s); a failed burst write means "too fast", as in quota.ts.
  try { await kv.put(bKey, String(burst + 1), { expirationTtl: 120 }); } catch { return tooFast; }
  const charged: QuotaState = { requests: q?.requests ?? 0, tokens: tokens + Math.max(0, Math.ceil(estimateTokens)) };
  try {
    await Promise.all([
      kv.put(dKey, String(d + weight), { expirationTtl: 2 * 86400 }),
      kv.put(mKey, String(m + weight), { expirationTtl: TTL }),
      kv.put(qKey, JSON.stringify(charged), { expirationTtl: 2 * 86400 }),
    ]);
  } catch { /* fail open on accounting, like quota.ts */ }
  const requests = Math.max(0, Math.min(dayCap - d - weight, monthCap - m - weight));
  return { ok: true, resetAt: nextUtcMidnight(now), day, charged, remaining: { requests, tokens: Math.max(0, TOKEN_DAY[plan] - charged.tokens) } };
}

export async function voiceAllowance(kv: KVNamespace, sub: string, plan: Paid, mk: string, now: number): Promise<number> {
  const L = LIMITS[plan];
  const monthUsed = await num(kv, `m:voice:${sub}:${mk}`);
  const todayUsed = (await readVoice(kv, sub, utcDay(now))).seconds;
  return Math.max(0, Math.min(L.voiceDaySec, L.voiceMonthSec - monthUsed + todayUsed));
}
/** Seconds left in the month window, before today's day cap applies. */
export async function voiceMonthLeft(kv: KVNamespace, sub: string, plan: Paid, mk: string): Promise<number> {
  return Math.max(0, LIMITS[plan].voiceMonthSec - (await num(kv, `m:voice:${sub}:${mk}`)));
}
export async function addVoiceMonth(kv: KVNamespace, sub: string, mk: string, deltaSec: number): Promise<void> {
  const k = `m:voice:${sub}:${mk}`;
  await kv.put(k, String(Math.max(0, (await num(kv, k)) + deltaSec)), { expirationTtl: TTL });
}

/** Resolves the caller's plan and month key when the paywall is on; null means "use legacy anonymous quotas". */
export async function gateFor(env: Env, s: SessionPayload, now: number): Promise<{ plan: Paid; month: MonthWindow } | "account_required" | "account_unavailable" | null> {
  if (!paywallOn(env)) return null;
  const plan = sessionPlan(s);
  if (plan === "anon" || !s.uid) return "account_required";
  let periodEnd: number | null = null;
  if (plan === "pro") {
    try { periodEnd = (await getUser(env.DB, s.uid))?.current_period_end ?? null; } catch { return "account_unavailable"; }
  }
  return { plan, month: monthWindow(plan, periodEnd, now) };
}
