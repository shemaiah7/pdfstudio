import { utcDay } from "./session";
import { nextUtcMidnight } from "./quota";

export const ADMISSION_SECONDS = 600;
export const MIN_BILLED_SECONDS = 15;
const TTL = 2 * 86400;

export interface VoiceState { seconds: number; charged: Record<string, number> }
const key = (vid: string, day: string) => `v:${vid}:${day}`;

export async function readVoice(kv: KVNamespace, vid: string, day: string): Promise<VoiceState> {
  const s = await kv.get<Partial<VoiceState>>(key(vid, day), "json");
  return { seconds: typeof s?.seconds === "number" ? s.seconds : 0, charged: s?.charged && typeof s.charged === "object" ? s.charged : {} };
}

async function write(kv: KVNamespace, vid: string, day: string, charged: Record<string, number>): Promise<VoiceState> {
  const state: VoiceState = { seconds: Object.values(charged).reduce((a, b) => a + b, 0), charged };
  try { await kv.put(key(vid, day), JSON.stringify(state), { expirationTtl: TTL }); } catch { /* fail open on accounting */ }
  return state;
}

/** Read-only admission decision: the caller charges after the upstream token succeeds. */
export async function admitVoice(kv: KVNamespace, vid: string, limit: number, now: number = Date.now() / 1000): Promise<{ ok: true; day: string; resetAt: number; state: VoiceState } | { ok: false; resetAt: number }> {
  const day = utcDay(now);
  const resetAt = nextUtcMidnight(now);
  const state = await readVoice(kv, vid, day);
  if (state.seconds + ADMISSION_SECONDS > limit) return { ok: false, resetAt };
  return { ok: true, day, resetAt, state };
}

export async function chargeVoice(kv: KVNamespace, vid: string, day: string, conversationId: string, seconds: number): Promise<VoiceState> {
  const state = await readVoice(kv, vid, day);
  return write(kv, vid, day, { ...state.charged, [conversationId]: seconds });
}

/** Replaces the admission charge with the actual duration (floored at 15 s). Null when the id is unknown to this visitor-day. */
export async function reconcileVoice(kv: KVNamespace, vid: string, day: string, conversationId: string, actual: number): Promise<VoiceState | null> {
  const state = await readVoice(kv, vid, day);
  if (!Object.hasOwn(state.charged, conversationId)) return null;
  return write(kv, vid, day, { ...state.charged, [conversationId]: Math.max(MIN_BILLED_SECONDS, Math.round(actual)) });
}
