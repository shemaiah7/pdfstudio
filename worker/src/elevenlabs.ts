export const EL_BASE = "https://api.elevenlabs.io";

export class ElevenLabsError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = "ElevenLabsError"; this.status = status; }
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await run(c.signal); } finally { clearTimeout(t); }
}

/** Mints a WebRTC conversation token for a private agent. The body of a failed reply is never logged. */
export async function createConversationToken(apiKey: string, agentId: string, fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<{ token: string; conversationId: string }> {
  let res: Response;
  try {
    res = await withTimeout(timeoutMs, (signal) => fetchFn(`${EL_BASE}/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, { method: "GET", headers: { "xi-api-key": apiKey }, signal }));
  } catch { throw new ElevenLabsError(0, "network"); }
  if (!res.ok) throw new ElevenLabsError(res.status, "upstream");
  const body = (await res.json().catch(() => null)) as { token?: unknown; conversation_id?: unknown } | null;
  if (!body || typeof body.token !== "string" || typeof body.conversation_id !== "string") throw new ElevenLabsError(502, "bad_reply");
  return { token: body.token, conversationId: body.conversation_id };
}

/** Seconds ElevenLabs billed for a conversation, or null when the record is unavailable (deleted, not found, network). */
export async function getConversationDuration(apiKey: string, conversationId: string, fetchFn: typeof fetch = fetch, timeoutMs = 5_000): Promise<number | null> {
  try {
    const res = await withTimeout(timeoutMs, (signal) => fetchFn(`${EL_BASE}/v1/convai/conversations/${encodeURIComponent(conversationId)}`, { method: "GET", headers: { "xi-api-key": apiKey }, signal }));
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { metadata?: { call_duration_secs?: unknown } } | null;
    const secs = body?.metadata?.call_duration_secs;
    return typeof secs === "number" && Number.isFinite(secs) && secs >= 0 ? Math.round(secs) : null;
  } catch { return null; }
}
