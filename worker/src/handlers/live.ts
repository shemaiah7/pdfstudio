import type { Env } from "../env";
import { json } from "../cors";
import { verifySession, utcDay, type SessionPayload } from "../session";
import { createConversationToken, getConversationDuration, ElevenLabsError } from "../elevenlabs";
import { admitVoice, chargeVoice, reconcileVoice, readVoice, ADMISSION_SECONDS } from "../voiceQuota";

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
  const limit = dailyVoiceSeconds(env);
  const admit = await admitVoice(env.QUOTA, session.vid, limit);
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
  const state = await chargeVoice(env.QUOTA, session.vid, admit.day, minted.conversationId, ADMISSION_SECONDS);
  console.log(JSON.stringify({ task: "live", vid: session.vid, status: "admitted" }));
  return json({ conversationId: minted.conversationId, token: minted.token, remainingSeconds: Math.max(0, limit - state.seconds), resetAt: admit.resetAt }, 200, env);
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
  const day = utcDay();
  const duration = await deps.getDuration(env.ELEVENLABS_API_KEY, b.conversationId);
  const verified = duration !== null;
  const actual = duration ?? b.seconds;
  const state = await reconcileVoice(env.QUOTA, session.vid, day, b.conversationId, actual, Date.now() / 1000, verified);
  if (!state) return json({ error: "unknown_conversation" }, 404, env);
  console.log(JSON.stringify({ task: "live", vid: session.vid, status: "reconciled", seconds: Math.round(actual) }));
  return json({ remainingSeconds: Math.max(0, dailyVoiceSeconds(env) - state.seconds) }, 200, env);
}
