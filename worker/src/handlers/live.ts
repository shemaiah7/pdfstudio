import type { Env } from "../env";
import { json } from "../cors";
import { verifySession, utcDay, type SessionPayload } from "../session";
import { createConversationToken, getConversationDuration, ElevenLabsError } from "../elevenlabs";
import { gateFor, voiceAllowance, addVoiceMonth } from "../limits";
import { admitVoice, chargeVoice, reconcileVoice, readVoice, ADMISSION_SECONDS } from "../voiceQuota";

const MIN_GATED_SESSION_SECONDS = 60;

export interface LiveDeps { createToken: typeof createConversationToken; getDuration: typeof getConversationDuration }
const defaultDeps: LiveDeps = { createToken: createConversationToken, getDuration: getConversationDuration };

export function dailyVoiceSeconds(env: Env): number {
  const n = Number(env.VOICE_DAILY_SECONDS ?? "1800");
  return Number.isFinite(n) && n > 0 ? n : 1800;
}

async function authed(request: Request, env: Env): Promise<SessionPayload | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token ? verifySession(token, env.SESSION_SECRET) : null;
}

export async function liveHandler(request: Request, env: Env, deps: LiveDeps = defaultDeps): Promise<Response> {
  const session = await authed(request, env);
  if (!session) return json({ error: "unauthorized" }, 401, env);
  const now = Date.now() / 1000;
  const gate = await gateFor(env, session, now);
  if (gate === "account_required") return json({ error: "account_required" }, 403, env);
  if (gate === "account_unavailable") return json({ error: "account_unavailable" }, 503, env);
  const limit = gate ? await voiceAllowance(env.QUOTA, session.vid, gate.plan, gate.mk, now) : dailyVoiceSeconds(env);
  // A gated caller with less than a full session left but at least a minute is admitted for what remains (the app ends the call at maxSeconds).
  const admit = await admitVoice(env.QUOTA, session.vid, limit, now, gate ? MIN_GATED_SESSION_SECONDS : ADMISSION_SECONDS);
  if (!admit.ok) {
    // Report what is left and what a session reserves, so the app can say "needs 10 free minutes" when time remains.
    const used = (await readVoice(env.QUOTA, session.vid, utcDay())).seconds;
    return json({ error: "voice_limit", resetAt: admit.resetAt, remainingSeconds: Math.max(0, limit - used), sessionSeconds: ADMISSION_SECONDS }, 429, env);
  }
  let minted: { token: string; conversationId: string };
  try {
    minted = await deps.createToken(env.ELEVENLABS_API_KEY, env.ELEVENLABS_AGENT_ID);
  } catch (err) {
    console.log(JSON.stringify({ task: "live", vid: session.vid, status: "error", kind: err instanceof ElevenLabsError ? err.status : "unknown" }));
    return json({ error: "voice_unavailable" }, 502, env);
  }
  const state = await chargeVoice(env.QUOTA, session.vid, admit.day, minted.conversationId, admit.reserve, now);
  if (gate) await addVoiceMonth(env.QUOTA, session.vid, gate.mk, admit.reserve);
  console.log(JSON.stringify({ task: "live", vid: session.vid, status: "admitted" }));
  return json({ conversationId: minted.conversationId, token: minted.token, remainingSeconds: Math.max(0, limit - state.seconds), maxSeconds: admit.reserve, resetAt: admit.resetAt }, 200, env);
}

export async function liveUsageHandler(request: Request, env: Env, deps: LiveDeps = defaultDeps): Promise<Response> {
  const session = await authed(request, env);
  if (!session) return json({ error: "unauthorized" }, 401, env);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "invalid_body" }, 400, env); }
  const b = raw as { conversationId?: unknown; seconds?: unknown };
  if (!b || typeof b.conversationId !== "string" || b.conversationId.length < 1 || b.conversationId.length > 200 || typeof b.seconds !== "number" || !Number.isFinite(b.seconds) || b.seconds < 0 || b.seconds > 600) {
    return json({ error: "invalid_body" }, 400, env);
  }
  const now = Date.now() / 1000;
  const gate = await gateFor(env, session, now);
  if (gate === "account_required") return json({ error: "account_required" }, 403, env);
  if (gate === "account_unavailable") return json({ error: "account_unavailable" }, 503, env);
  const day = utcDay();
  const duration = await deps.getDuration(env.ELEVENLABS_API_KEY, b.conversationId);
  const verified = duration !== null;
  const actual = duration ?? b.seconds;
  const state = await reconcileVoice(env.QUOTA, session.vid, day, b.conversationId, actual, now, verified);
  if (!state) return json({ error: "unknown_conversation" }, 404, env);
  if (gate && state.delta !== 0) await addVoiceMonth(env.QUOTA, session.vid, gate.mk, state.delta);
  console.log(JSON.stringify({ task: "live", vid: session.vid, status: "reconciled", seconds: Math.round(actual) }));
  const limit = gate ? await voiceAllowance(env.QUOTA, session.vid, gate.plan, gate.mk, now) : dailyVoiceSeconds(env);
  return json({ remainingSeconds: Math.max(0, limit - state.seconds) }, 200, env);
}
