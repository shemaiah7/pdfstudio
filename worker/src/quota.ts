import { utcDay } from "./session";

export const DAILY_REQUESTS = 20;
export const DAILY_TOKENS = 200_000;
export const BURST_REQUESTS = 5;

export interface QuotaState { requests: number; tokens: number }
export type QuotaCheck =
  | { ok: true; remaining: { requests: number; tokens: number }; resetAt: number; day: string }
  | { ok: false; reason: "daily_limit" | "too_fast"; resetAt: number };

export function nextUtcMidnight(now: number = Date.now() / 1000): number {
  const d = new Date(now * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000;
}

async function readState(kv: KVNamespace, key: string): Promise<QuotaState> {
  return (await kv.get<QuotaState>(key, "json")) ?? { requests: 0, tokens: 0 };
}

export async function checkQuota(kv: KVNamespace, vid: string, now: number = Date.now() / 1000): Promise<QuotaCheck> {
  const day = utcDay(now);
  const resetAt = nextUtcMidnight(now);
  const minute = Math.floor(now / 60);
  const burstKey = `b:${vid}:${minute}`;
  const burst = Number((await kv.get(burstKey)) ?? "0");
  if (burst >= BURST_REQUESTS) return { ok: false, reason: "too_fast", resetAt: (minute + 1) * 60 };
  await kv.put(burstKey, String(burst + 1), { expirationTtl: 120 });

  const state = await readState(kv, `q:${vid}:${day}`);
  if (state.requests >= DAILY_REQUESTS || state.tokens >= DAILY_TOKENS) {
    return { ok: false, reason: "daily_limit", resetAt };
  }
  return {
    ok: true,
    day,
    resetAt,
    remaining: { requests: DAILY_REQUESTS - state.requests, tokens: DAILY_TOKENS - state.tokens },
  };
}

export async function recordUsage(kv: KVNamespace, vid: string, day: string, tokens: number): Promise<QuotaState> {
  const key = `q:${vid}:${day}`;
  const state = await readState(kv, key);
  const next = { requests: state.requests + 1, tokens: state.tokens + Math.max(0, tokens) };
  await kv.put(key, JSON.stringify(next), { expirationTtl: 2 * 86400 });
  return next;
}
