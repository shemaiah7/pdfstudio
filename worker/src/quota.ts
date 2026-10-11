import { utcDay } from "./session";

export const DAILY_REQUESTS = 20;
export const DAILY_TOKENS = 200_000;
export const BURST_REQUESTS = 5;

export interface QuotaState { requests: number; tokens: number }
export type QuotaCheck =
  | { ok: true; remaining: { requests: number; tokens: number }; resetAt: number; day: string; charged: QuotaState }
  | { ok: false; reason: "daily_limit" | "too_fast"; resetAt: number };

export function nextUtcMidnight(now: number = Date.now() / 1000): number {
  const d = new Date(now * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000;
}

async function readState(kv: KVNamespace, key: string): Promise<QuotaState> {
  return (await kv.get<QuotaState>(key, "json")) ?? { requests: 0, tokens: 0 };
}

export async function checkQuota(kv: KVNamespace, vid: string, now: number = Date.now() / 1000, estimateTokens = 0, weight = 1): Promise<QuotaCheck> {
  const day = utcDay(now);
  const resetAt = nextUtcMidnight(now);
  const minute = Math.floor(now / 60);
  const state = await readState(kv, `q:${vid}:${day}`);
  if (state.requests + weight > DAILY_REQUESTS || state.tokens >= DAILY_TOKENS) {
    return { ok: false, reason: "daily_limit", resetAt };
  }

  const burstKey = `b:${vid}:${minute}`;
  const burst = Number((await kv.get(burstKey)) ?? "0");
  if (burst >= BURST_REQUESTS) return { ok: false, reason: "too_fast", resetAt: (minute + 1) * 60 };
  try {
    await kv.put(burstKey, String(burst + weight), { expirationTtl: 120 });
  } catch {
    // KV limits same-key writes (~1/s); treat a failed write as "too fast" so the client retries.
    return { ok: false, reason: "too_fast", resetAt: (minute + 1) * 60 };
  }
  // Charge the request and an input-token estimate at admission so a client that disconnects
  // before the first upstream event is still counted; the handler reconciles at the end.
  const charged: QuotaState = { requests: state.requests + weight, tokens: state.tokens + Math.max(0, Math.ceil(estimateTokens)) };
  try {
    await kv.put(`q:${vid}:${day}`, JSON.stringify(charged), { expirationTtl: 2 * 86400 });
  } catch {
    // fail open on accounting
  }
  return {
    ok: true,
    day,
    resetAt,
    charged,
    remaining: { requests: DAILY_REQUESTS - state.requests, tokens: DAILY_TOKENS - state.tokens },
  };
}

export async function recordTokens(kv: KVNamespace, vid: string, day: string, tokens: number): Promise<QuotaState> {
  const key = `q:${vid}:${day}`;
  const state = await readState(kv, key);
  const next = { requests: state.requests, tokens: state.tokens + Math.max(0, tokens) };
  const body = JSON.stringify(next);
  try {
    await kv.put(key, body, { expirationTtl: 2 * 86400 });
  } catch {
    // KV limits same-key writes (~1/s): retry once after a second, then fail open on accounting.
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await kv.put(key, body, { expirationTtl: 2 * 86400 });
    } catch {
      // never crash an already-streamed response
    }
  }
  return next;
}
