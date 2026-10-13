import type { Env } from "./env";
import { paywallOn, type Plan } from "./plan";
import { sessionPlan, utcDay, type SessionPayload } from "./session";
import { nextUtcMidnight } from "./quota";
import { readVoice } from "./voiceQuota";
import { getUser } from "./users";

type Paid = Exclude<Plan, "anon">;
export const LIMITS: Record<Paid, { aiDay: number; aiMonth: number; voiceDaySec: number; voiceMonthSec: number; ocrMonth: number; edit: boolean }> = {
  free: { aiDay: 5, aiMonth: 5 * 31, voiceDaySec: 300, voiceMonthSec: 300 * 31, ocrMonth: 0, edit: false },
  trial: { aiDay: 100, aiMonth: 1000, voiceDaySec: 1800, voiceMonthSec: 7200, ocrMonth: 300, edit: true },
  pro: { aiDay: 100, aiMonth: 1000, voiceDaySec: 1800, voiceMonthSec: 7200, ocrMonth: 300, edit: true },
};

export function monthKey(plan: Plan, periodEnd: number | null, now: number): string {
  return plan === "pro" && periodEnd ? `p${periodEnd}` : new Date(now * 1000).toISOString().slice(0, 7);
}
function monthReset(mk: string, now: number): number {
  if (mk.startsWith("p")) return Number(mk.slice(1));
  const d = new Date(now * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}
const num = async (kv: KVNamespace, k: string) => Number((await kv.get(k)) ?? "0");
const TTL = 40 * 86400;

export type UsageCheck = { ok: true; resetAt: number } | { ok: false; error: "daily_limit" | "monthly_limit" | "pro_required"; resetAt: number; scope: "day" | "month" };

export async function checkUsage(kv: KVNamespace, sub: string, plan: Paid, kind: "ai" | "ocr", weight: number, mk: string, now: number): Promise<UsageCheck> {
  const L = LIMITS[plan];
  const dayCap = kind === "ai" ? L.aiDay : Infinity;
  const monthCap = kind === "ai" ? L.aiMonth : L.ocrMonth;
  if (monthCap === 0) return { ok: false, error: "pro_required", resetAt: 0, scope: "month" };
  const dKey = `d:${kind}:${sub}:${utcDay(now)}`, mKey = `m:${kind}:${sub}:${mk}`;
  const [d, m] = await Promise.all([num(kv, dKey), num(kv, mKey)]);
  if (m + weight > monthCap) return { ok: false, error: "monthly_limit", resetAt: monthReset(mk, now), scope: "month" };
  if (d + weight > dayCap) return { ok: false, error: "daily_limit", resetAt: nextUtcMidnight(now), scope: "day" };
  try { await Promise.all([kv.put(dKey, String(d + weight), { expirationTtl: 2 * 86400 }), kv.put(mKey, String(m + weight), { expirationTtl: TTL })]); } catch { /* fail open on accounting, like quota.ts */ }
  return { ok: true, resetAt: nextUtcMidnight(now) };
}

export async function voiceAllowance(kv: KVNamespace, sub: string, plan: Paid, mk: string, now: number): Promise<number> {
  const L = LIMITS[plan];
  const monthUsed = await num(kv, `m:voice:${sub}:${mk}`);
  const todayUsed = (await readVoice(kv, sub, utcDay(now))).seconds;
  return Math.max(0, Math.min(L.voiceDaySec, L.voiceMonthSec - monthUsed + todayUsed));
}
export async function addVoiceMonth(kv: KVNamespace, sub: string, mk: string, deltaSec: number): Promise<void> {
  const k = `m:voice:${sub}:${mk}`;
  await kv.put(k, String(Math.max(0, (await num(kv, k)) + deltaSec)), { expirationTtl: TTL });
}

/** Resolves the caller's plan and month key when the paywall is on; null means "use legacy anonymous quotas". */
export async function gateFor(env: Env, s: SessionPayload, now: number): Promise<{ plan: Paid; mk: string } | "account_required" | "account_unavailable" | null> {
  if (!paywallOn(env)) return null;
  const plan = sessionPlan(s);
  if (plan === "anon" || !s.uid) return "account_required";
  let periodEnd: number | null = null;
  if (plan === "pro") {
    try { periodEnd = (await getUser(env.DB, s.uid))?.current_period_end ?? null; } catch { return "account_unavailable"; }
  }
  return { plan, mk: monthKey(plan, periodEnd, now) };
}
