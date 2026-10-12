import { utcDay } from "./session";
import { nextUtcMidnight } from "./quota";

export const ADMISSION_SECONDS = 600;
export const MIN_BILLED_SECONDS = 15;
const TTL = 2 * 86400;

export interface VoiceState { seconds: number; charged: Record<string, number>; admitted: Record<string, number>; pending: Record<string, number>; verified: Record<string, true> }
const key = (vid: string, day: string) => `v:${vid}:${day}`;
const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);
const floorBilled = (n: number) => Math.max(MIN_BILLED_SECONDS, Math.round(n));
const asMap = (m: unknown): Record<string, number> => (m && typeof m === "object" ? (m as Record<string, number>) : {});

export async function readVoice(kv: KVNamespace, vid: string, day: string): Promise<VoiceState> {
  const s = await kv.get<Partial<VoiceState>>(key(vid, day), "json");
  return { seconds: typeof s?.seconds === "number" ? s.seconds : 0, charged: asMap(s?.charged), admitted: asMap(s?.admitted), pending: asMap(s?.pending), verified: asMap(s?.verified) as unknown as Record<string, true> };
}

async function write(kv: KVNamespace, vid: string, day: string, state: Omit<VoiceState, "seconds">): Promise<VoiceState> {
  const full: VoiceState = { seconds: sum(state.charged), charged: state.charged, admitted: state.admitted, pending: state.pending, verified: state.verified };
  try { await kv.put(key(vid, day), JSON.stringify(full), { expirationTtl: TTL }); } catch { /* fail open on accounting */ }
  return full;
}

/** Pure: applies client-reported durations whose session window (admission + 600 s) has passed. */
export function settlePending(state: VoiceState, now: number): VoiceState {
  const charged = { ...state.charged };
  const pending = { ...state.pending };
  for (const id of Object.keys(pending)) {
    if (state.verified[id]) { delete pending[id]; continue; } // a verified duration is final
    if (now >= (state.admitted[id] ?? 0) + ADMISSION_SECONDS) {
      charged[id] = floorBilled(pending[id]);
      delete pending[id];
    }
  }
  return { seconds: sum(charged), charged, admitted: state.admitted, pending, verified: state.verified };
}

/** Read-only admission decision (apart from persisting settled pending reports): the caller charges after the upstream token succeeds. */
export async function admitVoice(kv: KVNamespace, vid: string, limit: number, now: number = Date.now() / 1000): Promise<{ ok: true; day: string; resetAt: number; state: VoiceState } | { ok: false; resetAt: number }> {
  const day = utcDay(now);
  const midnight = nextUtcMidnight(now);
  let resetAt = midnight;
  let state = await readVoice(kv, vid, day);
  if (Object.keys(state.pending).length) {
    const settled = settlePending(state, now);
    if (Object.keys(settled.pending).length !== Object.keys(state.pending).length) state = await write(kv, vid, day, settled);
  }
  if (state.seconds + ADMISSION_SECONDS > limit) {
    // Pending client reports will lower the charge once their session windows pass; point at the first moment that makes room.
    let seconds = state.seconds;
    const ids = Object.keys(state.pending).sort((a, b) => (state.admitted[a] ?? 0) - (state.admitted[b] ?? 0));
    for (const id of ids) {
      seconds += floorBilled(state.pending[id]) - (state.charged[id] ?? 0);
      if (seconds + ADMISSION_SECONDS <= limit) { resetAt = Math.min(midnight, (state.admitted[id] ?? 0) + ADMISSION_SECONDS); break; }
    }
    return { ok: false, resetAt };
  }
  return { ok: true, day, resetAt, state };
}

export async function chargeVoice(kv: KVNamespace, vid: string, day: string, conversationId: string, seconds: number, now: number = Date.now() / 1000): Promise<VoiceState> {
  const state = await readVoice(kv, vid, day);
  return write(kv, vid, day, { charged: { ...state.charged, [conversationId]: seconds }, admitted: { ...state.admitted, [conversationId]: now }, pending: state.pending, verified: state.verified });
}

/** Verified durations apply at once; unverified (client-reported) ones wait until the session window has passed. Null when the id is unknown to this visitor-day. */
export async function reconcileVoice(kv: KVNamespace, vid: string, day: string, conversationId: string, actual: number, now: number = Date.now() / 1000, verified: boolean = false): Promise<VoiceState | null> {
  const state = await readVoice(kv, vid, day);
  if (!Object.hasOwn(state.charged, conversationId)) return null;
  if (!verified && state.verified[conversationId]) return state; // already settled by a verified duration
  const pending = { ...state.pending };
  const charged = { ...state.charged };
  const flags = { ...state.verified };
  if (verified) flags[conversationId] = true;
  if (verified || now >= (state.admitted[conversationId] ?? 0) + ADMISSION_SECONDS) {
    charged[conversationId] = floorBilled(actual);
    delete pending[conversationId];
  } else {
    pending[conversationId] = actual;
  }
  return write(kv, vid, day, { charged, admitted: state.admitted, pending, verified: flags });
}
