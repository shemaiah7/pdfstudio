# Voice Conversation (ElevenLabs Agents + Claude) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Voice" tab where a clinician talks with an ElevenLabs agent (Claude Sonnet 5.5 as the LLM) about the open document; the agent pulls passages from the browser through a client tool, usage is metered per visitor-day by the worker, and nothing is retained server-side.

**Architecture:** The worker mints ElevenLabs conversation tokens behind the existing Turnstile session and keeps a per-visitor-day voice quota in KV, reconciling actual minutes from ElevenLabs' conversation record. The browser wraps `@elevenlabs/client` in a small `LiveClient`, registers a `search_document` client tool that runs the Search module's retrieval (keyword fallback), and drives a Zustand `useLiveStore` behind a `VoiceTab`. The agent and its tool are provisioned from code by a script so prompt, LLM, and privacy settings are versioned.

**Tech Stack:** Cloudflare Workers + KV (existing worker, vitest with `@cloudflare/vitest-plugin`), `@elevenlabs/client` 1.27.0 (WebRTC), React 19, Zustand 5, Vitest 5 (jsdom for components), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-voice-live-design.md`

## Global Constraints

- Worker secrets: `ELEVENLABS_API_KEY` (never logged, never printed, never read by anyone but the worker and the provisioning script). `OPENAI_API_KEY` exists and is unused; do not reference it.
- Worker vars (`wrangler.jsonc`): `ELEVENLABS_AGENT_ID` (string, empty until provisioned), `VOICE_DAILY_SECONDS` (string `"1800"`).
- Quota numbers: admission charge 600 s; minimum billed 15 s per conversation; daily default 1800 s; session cap 600 s; silence timeout 120 s; client tool timeout 8 s; worker ElevenLabs timeouts 10 s (token) and 5 s (conversation lookup).
- LLM `claude-sonnet-5-5`, temperature 0; TTS `eleven_v4_turbo`, voice `cjVigY5qzO86Huf0OWal`; agent name `PDF Studio Voice`; tool name `search_document`.
- Error codes from the worker: `unauthorized`, `invalid_body`, `voice_limit` (+ `resetAt`), `voice_unavailable`, `unknown_conversation`.
- Browser copy (verbatim): disclosure "Voice sends your microphone audio to ElevenLabs and the passages of this document needed to answer each question to ElevenLabs and Anthropic. Recordings are not kept. About $0.10 per minute, 30 minutes per day."; errors "Microphone access is needed for voice.", "Voice allowance used for today; resets at HH:MM.", "Voice service unavailable right now.", "Connection lost", "Session ended"; status "Using keyword matching (search model not loaded)"; no-match tool result "No passage in the document matched that query."
- Test IDs: `panel-tab-voice`, `voice-start`, `voice-captions`, `voice-mute`, `voice-end`, `voice-status`, `voice-error`.
- The worker never logs transcripts, tokens, or request bodies from ElevenLabs; log lines are JSON with `task: "live"` and status/kind only.
- `npx tsc -b` (root) and `npm --prefix worker run typecheck` must stay clean; `npm test` and `npm --prefix worker test` must pass after every task.
- `.superpowers/` and `worker/.dev.vars` are never committed.

## Review Focus

1. **Allowance exhausted mid-day by a second session:** a visitor with 1300 s used asks for a session (1300 + 600 > 1800) and must get `voice_limit` with `resetAt`, not a token. Pinned in Task 3.
2. **Conversation record gone at reconciliation (zero retention):** `/live/usage` must fall back to the client's seconds on 404/network error and never fail the request. Pinned in Task 3.
3. **Microphone denied:** no token is minted and no quota is charged when the mic pre-check fails. Pinned in Task 7.
4. **Search slower than the tool timeout:** the tool returns the no-match string after 8 s and never throws into the SDK. Pinned in Task 7.
5. **Document closed while live:** the session ends, usage is reported, captions stay. Pinned in Task 7.

---

### Task 1: ElevenLabs API module in the worker

**Files:**
- Create: `worker/src/elevenlabs.ts`
- Test: `worker/test/elevenlabs.test.ts`

**Interfaces:**
- Produces: `createConversationToken(apiKey: string, agentId: string, fetchFn?: typeof fetch, timeoutMs?: number): Promise<{ token: string; conversationId: string }>` (throws `ElevenLabsError` with `.status`), `getConversationDuration(apiKey: string, conversationId: string, fetchFn?: typeof fetch, timeoutMs?: number): Promise<number | null>`, `EL_BASE`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/test/elevenlabs.test.ts
import { describe, it, expect } from "vitest";
import { createConversationToken, getConversationDuration, ElevenLabsError } from "../src/elevenlabs";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createConversationToken", () => {
  it("GETs the token endpoint with the key header and maps the reply", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => { seen = { url, init }; return ok({ token: "tok", conversation_id: "conv_1" }); }) as unknown as typeof fetch;
    const r = await createConversationToken("k", "agent_x", fetchFn);
    expect(r).toEqual({ token: "tok", conversationId: "conv_1" });
    expect(seen!.url).toBe("https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_x");
    expect(seen!.init.method).toBe("GET");
    expect((seen!.init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
  });
  it("throws ElevenLabsError with the upstream status on non-2xx", async () => {
    const fetchFn = (async () => ok({ detail: "nope" }, 401)) as unknown as typeof fetch;
    await expect(createConversationToken("k", "a", fetchFn)).rejects.toMatchObject({ name: "ElevenLabsError", status: 401 });
  });
  it("throws ElevenLabsError status 0 on network failure", async () => {
    const fetchFn = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    await expect(createConversationToken("k", "a", fetchFn)).rejects.toBeInstanceOf(ElevenLabsError);
  });
  it("rejects a reply without a token", async () => {
    const fetchFn = (async () => ok({ conversation_id: "c" })) as unknown as typeof fetch;
    await expect(createConversationToken("k", "a", fetchFn)).rejects.toMatchObject({ status: 502 });
  });
});

describe("getConversationDuration", () => {
  it("returns call_duration_secs", async () => {
    const fetchFn = (async (url: string) => { expect(url).toBe("https://api.elevenlabs.io/v1/convai/conversations/conv_1"); return ok({ status: "done", metadata: { call_duration_secs: 42 } }); }) as unknown as typeof fetch;
    expect(await getConversationDuration("k", "conv_1", fetchFn)).toBe(42);
  });
  it("returns null on 404, network error, or a missing field", async () => {
    expect(await getConversationDuration("k", "c", (async () => ok({}, 404)) as unknown as typeof fetch)).toBeNull();
    expect(await getConversationDuration("k", "c", (async () => { throw new Error("net"); }) as unknown as typeof fetch)).toBeNull();
    expect(await getConversationDuration("k", "c", (async () => ok({ metadata: {} })) as unknown as typeof fetch)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix worker test -- test/elevenlabs.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
// worker/src/elevenlabs.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix worker test -- test/elevenlabs.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/elevenlabs.ts worker/test/elevenlabs.test.ts
git commit -m "feat(worker): ElevenLabs token and conversation lookup client"
```

---

### Task 2: Voice quota in KV

**Files:**
- Create: `worker/src/voiceQuota.ts`
- Test: `worker/test/voiceQuota.test.ts`

**Interfaces:**
- Consumes: `utcDay`, `nextUtcMidnight` from `worker/src/session.ts` and `worker/src/quota.ts`.
- Produces: `ADMISSION_SECONDS = 600`, `MIN_BILLED_SECONDS = 15`, `interface VoiceState { seconds: number; charged: Record<string, number> }`, `readVoice(kv, vid, day): Promise<VoiceState>`, `admitVoice(kv, vid, limit, now?): Promise<{ ok: true; day: string; resetAt: number; state: VoiceState } | { ok: false; resetAt: number }>` (read-only decision), `chargeVoice(kv, vid, day, conversationId, seconds): Promise<VoiceState>` (sets `charged[id]`, recomputes `seconds`), `reconcileVoice(kv, vid, day, conversationId, actual): Promise<VoiceState | null>` (null when the id was never charged; otherwise `max(actual, 15)`).

- [ ] **Step 1: Write the failing tests**

```ts
// worker/test/voiceQuota.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { admitVoice, chargeVoice, reconcileVoice, readVoice, ADMISSION_SECONDS } from "../src/voiceQuota";

const day = new Date().toISOString().slice(0, 10);
let n = 0; const vid = () => `v${++n}`;

describe("voice quota", () => {
  it("admits a fresh visitor and reports the day", async () => {
    const r = await admitVoice(env.QUOTA, vid(), 1800);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.day).toBe(day); expect(r.state).toEqual({ seconds: 0, charged: {} }); expect(r.resetAt).toBeGreaterThan(Date.now() / 1000); }
  });
  it("refuses when the admission charge would exceed the limit", async () => {
    const v = vid();
    await env.QUOTA.put(`v:${v}:${day}`, JSON.stringify({ seconds: 1300, charged: { a: 1300 } }));
    const r = await admitVoice(env.QUOTA, v, 1800);
    expect(r).toMatchObject({ ok: false });
    expect(await readVoice(env.QUOTA, v, day)).toMatchObject({ seconds: 1300 });
  });
  it("charges the admission and sums charged entries", async () => {
    const v = vid();
    const s1 = await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS);
    expect(s1).toEqual({ seconds: 600, charged: { c1: 600 } });
    const s2 = await chargeVoice(env.QUOTA, v, day, "c2", ADMISSION_SECONDS);
    expect(s2.seconds).toBe(1200);
    expect(await env.QUOTA.get(`v:${v}:${day}`, "json")).toEqual(s2);
  });
  it("reconciles to the actual duration with a 15 s floor, idempotently", async () => {
    const v = vid();
    await chargeVoice(env.QUOTA, v, day, "c1", ADMISSION_SECONDS);
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95)).toEqual({ seconds: 95, charged: { c1: 95 } });
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 95)).toEqual({ seconds: 95, charged: { c1: 95 } });
    expect(await reconcileVoice(env.QUOTA, v, day, "c1", 0)).toEqual({ seconds: 15, charged: { c1: 15 } });
  });
  it("returns null for a conversation that was never charged", async () => {
    expect(await reconcileVoice(env.QUOTA, vid(), day, "ghost", 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix worker test -- test/voiceQuota.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
// worker/src/voiceQuota.ts
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
  if (!(conversationId in state.charged)) return null;
  return write(kv, vid, day, { ...state.charged, [conversationId]: Math.max(MIN_BILLED_SECONDS, Math.round(actual)) });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix worker test -- test/voiceQuota.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/voiceQuota.ts worker/test/voiceQuota.test.ts
git commit -m "feat(worker): per-visitor-day voice quota with admission charge and reconciliation"
```

---

### Task 3: `/live` and `/live/usage` handlers, routes, env and vars

**Files:**
- Create: `worker/src/handlers/live.ts`
- Modify: `worker/src/env.ts`, `worker/src/index.ts`, `worker/wrangler.jsonc`, `worker/vitest.config.ts`
- Test: `worker/test/live.test.ts`, `worker/test/index.test.ts` (one routing case)

**Interfaces:**
- Consumes: Task 1 (`createConversationToken`, `getConversationDuration`, `ElevenLabsError`), Task 2 (`admitVoice`, `chargeVoice`, `reconcileVoice`, `readVoice`, `ADMISSION_SECONDS`), `verifySession` from `worker/src/session.ts`, `json` from `worker/src/cors.ts`.
- Produces: `liveHandler(request, env, deps?)` serving `POST /live` → `{ conversationId, token, remainingSeconds, resetAt }`; `liveUsageHandler(request, env, deps?)` serving `POST /live/usage` with body `{ conversationId: string; seconds: number }` → `{ remainingSeconds }`; `interface LiveDeps { createToken: typeof createConversationToken; getDuration: typeof getConversationDuration }`; `Env` gains `ELEVENLABS_API_KEY: string; ELEVENLABS_AGENT_ID: string; VOICE_DAILY_SECONDS?: string`; `dailyVoiceSeconds(env): number`.

- [ ] **Step 1: Extend env, vars and test bindings**

```ts
// worker/src/env.ts — add to Env
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_AGENT_ID: string;
  VOICE_DAILY_SECONDS?: string; // default "1800"
```

```jsonc
// worker/wrangler.jsonc — inside "vars"
    "ELEVENLABS_AGENT_ID": "",
    "VOICE_DAILY_SECONDS": "1800"
```

```ts
// worker/vitest.config.ts — inside miniflare.bindings
          ELEVENLABS_API_KEY: "el-test-key",
          ELEVENLABS_AGENT_ID: "agent_test",
          VOICE_DAILY_SECONDS: "1800",
```

- [ ] **Step 2: Write the failing tests**

```ts
// worker/test/live.test.ts
import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { liveHandler, liveUsageHandler, type LiveDeps } from "../src/handlers/live";
import { ElevenLabsError } from "../src/elevenlabs";
import { signSession } from "../src/session";

const day = new Date().toISOString().slice(0, 10);
const token = (vid: string) => signSession({ vid, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);
const okDeps = (): LiveDeps => ({ createToken: async () => ({ token: "tok", conversationId: "conv_1" }), getDuration: async () => 95 });

async function call(handler: typeof liveHandler, path: string, body: unknown, vid?: string, deps: LiveDeps = okDeps()) {
  const req = new Request(`https://ai.example${path}`, { method: "POST", headers: { "content-type": "application/json", ...(vid ? { authorization: `Bearer ${await token(vid)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = createExecutionContext();
  const res = await handler(req, env, deps);
  const json = (await res.json().catch(() => null)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  await waitOnExecutionContext(ctx);
  return { res, json };
}

describe("POST /live", () => {
  it("401 without a session", async () => { expect((await call(liveHandler, "/live", undefined)).res.status).toBe(401); });
  it("mints a token, charges 600 s, returns the remainder", async () => {
    let seenAgent = "";
    const deps: LiveDeps = { ...okDeps(), createToken: async (key, agent) => { expect(key).toBe("el-test-key"); seenAgent = agent; return { token: "tok", conversationId: "conv_1" }; } };
    const { res, json } = await call(liveHandler, "/live", undefined, "v-live-1", deps);
    expect(res.status).toBe(200);
    expect(seenAgent).toBe("agent_test");
    expect(json).toMatchObject({ conversationId: "conv_1", token: "tok", remainingSeconds: 1200 });
    expect(json.resetAt).toBeGreaterThan(Date.now() / 1000);
    expect(await env.QUOTA.get(`v:v-live-1:${day}`, "json")).toEqual({ seconds: 600, charged: { conv_1: 600 } });
  });
  it("429 voice_limit when 600 s would exceed the day", async () => {
    await env.QUOTA.put(`v:v-live-2:${day}`, JSON.stringify({ seconds: 1300, charged: { a: 1300 } }));
    let minted = false;
    const { res, json } = await call(liveHandler, "/live", undefined, "v-live-2", { ...okDeps(), createToken: async () => { minted = true; return { token: "t", conversationId: "c" }; } });
    expect(res.status).toBe(429);
    expect(json.error).toBe("voice_limit");
    expect(typeof json.resetAt).toBe("number");
    expect(minted).toBe(false);
  });
  it("502 voice_unavailable when ElevenLabs fails, without charging", async () => {
    const { res, json } = await call(liveHandler, "/live", undefined, "v-live-3", { ...okDeps(), createToken: async () => { throw new ElevenLabsError(500, "upstream"); } });
    expect(res.status).toBe(502);
    expect(json.error).toBe("voice_unavailable");
    expect(await env.QUOTA.get(`v:v-live-3:${day}`, "json")).toBeNull();
  });
  it("honours VOICE_DAILY_SECONDS", async () => {
    const small = Object.assign(Object.create(env), { VOICE_DAILY_SECONDS: "500" }) as typeof env; // prototype keeps the KV binding
    const req = new Request("https://ai.example/live", { method: "POST", headers: { authorization: `Bearer ${await token("v-live-4")}` } });
    const res = await liveHandler(req, small, okDeps());
    expect(res.status).toBe(429);
  });
});

describe("POST /live/usage", () => {
  it("400 on an invalid body", async () => {
    expect((await call(liveUsageHandler, "/live/usage", { conversationId: 5 }, "v-use-0")).res.status).toBe(400);
    expect((await call(liveUsageHandler, "/live/usage", { conversationId: "c", seconds: 9999 }, "v-use-0")).res.status).toBe(400);
  });
  it("reconciles from the ElevenLabs record", async () => {
    await env.QUOTA.put(`v:v-use-1:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 } }));
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 500 }, "v-use-1", { ...okDeps(), getDuration: async (_k, id) => (id === "conv_1" ? 95 : null) });
    expect(res.status).toBe(200);
    expect(json).toEqual({ remainingSeconds: 1705 });
    expect(await env.QUOTA.get(`v:v-use-1:${day}`, "json")).toEqual({ seconds: 95, charged: { conv_1: 95 } });
  });
  it("falls back to the client's seconds when the record is unavailable", async () => {
    await env.QUOTA.put(`v:v-use-2:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 } }));
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 130 }, "v-use-2", { ...okDeps(), getDuration: async () => null });
    expect(res.status).toBe(200);
    expect(json).toEqual({ remainingSeconds: 1670 });
  });
  it("404 unknown_conversation for an id this visitor never charged", async () => {
    const { res, json } = await call(liveUsageHandler, "/live/usage", { conversationId: "ghost", seconds: 10 }, "v-use-3");
    expect(res.status).toBe(404);
    expect(json.error).toBe("unknown_conversation");
  });
  it("is idempotent", async () => {
    await env.QUOTA.put(`v:v-use-4:${day}`, JSON.stringify({ seconds: 600, charged: { conv_1: 600 } }));
    await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 20 }, "v-use-4", { ...okDeps(), getDuration: async () => 40 });
    const { json } = await call(liveUsageHandler, "/live/usage", { conversationId: "conv_1", seconds: 20 }, "v-use-4", { ...okDeps(), getDuration: async () => 40 });
    expect(json).toEqual({ remainingSeconds: 1760 });
  });
});
```

Add to `worker/test/index.test.ts` inside `describe("routing")`:

```ts
  it("routes /live and /live/usage (401 without a session)", async () => {
    expect((await call("/live", { method: "POST" })).status).toBe(401);
    expect((await call("/live/usage", { method: "POST" })).status).toBe(401);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix worker test -- test/live.test.ts test/index.test.ts`
Expected: FAIL (handler module not found; routing returns 404).

- [ ] **Step 4: Implement the handlers and register the routes**

```ts
// worker/src/handlers/live.ts
import type { Env } from "../env";
import { json } from "../cors";
import { verifySession, utcDay, type SessionPayload } from "../session";
import { createConversationToken, getConversationDuration, ElevenLabsError } from "../elevenlabs";
import { admitVoice, chargeVoice, reconcileVoice, ADMISSION_SECONDS } from "../voiceQuota";

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
  if (!admit.ok) return json({ error: "voice_limit", resetAt: admit.resetAt }, 429, env);
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
  const actual = (await deps.getDuration(env.ELEVENLABS_API_KEY, b.conversationId)) ?? b.seconds;
  const state = await reconcileVoice(env.QUOTA, session.vid, day, b.conversationId, actual);
  if (!state) return json({ error: "unknown_conversation" }, 404, env);
  console.log(JSON.stringify({ task: "live", vid: session.vid, status: "reconciled", seconds: Math.round(actual) }));
  return json({ remainingSeconds: Math.max(0, dailyVoiceSeconds(env) - state.seconds) }, 200, env);
}
```

Register routes in `worker/src/index.ts`:

```ts
import { liveHandler, liveUsageHandler } from "./handlers/live";
// inside routes:
  "/live": (r, env) => liveHandler(r, env),
  "/live/usage": (r, env) => liveUsageHandler(r, env),
```

- [ ] **Step 5: Run the worker suite and typecheck**

Run: `npm --prefix worker test && npm --prefix worker run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add worker/src/handlers/live.ts worker/src/env.ts worker/src/index.ts worker/wrangler.jsonc worker/vitest.config.ts worker/test/live.test.ts worker/test/index.test.ts
git commit -m "feat(worker): /live mints ElevenLabs tokens behind the voice quota; /live/usage reconciles minutes"
```

---

### Task 4: Agent configuration and provisioning script

**Files:**
- Create: `worker/src/prompts/live.ts`, `worker/src/provision.ts`, `worker/scripts/provision-agent.ts`
- Test: `worker/test/provision.test.ts`

**Interfaces:**
- Produces: in `prompts/live.ts`: `LIVE_INSTRUCTIONS: string`, `AGENT_NAME = "PDF Studio Voice"`, `SEARCH_TOOL_NAME = "search_document"`, `searchToolBody(): object`, `agentBody(toolId: string, hostnames: string[], zeroRetention: boolean): object`. In `provision.ts`: `interface ElApi { get(path: string): Promise<{ status: number; body: any }>; post(path: string, body: unknown): Promise<{ status: number; body: any }>; patch(path: string, body: unknown): Promise<{ status: number; body: any }> }`, `provisionAgent(api: ElApi, hostnames: string[]): Promise<{ agentId: string; toolId: string; zeroRetention: boolean; privacy: unknown }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/test/provision.test.ts
import { describe, it, expect } from "vitest";
import { agentBody, searchToolBody, LIVE_INSTRUCTIONS, AGENT_NAME, SEARCH_TOOL_NAME } from "../src/prompts/live";
import { provisionAgent, type ElApi } from "../src/provision";

describe("agent config", () => {
  it("builds the tool body per spec", () => {
    const t = searchToolBody() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(t.tool_config).toMatchObject({ type: "client", name: SEARCH_TOOL_NAME, expects_response: true, response_timeout_secs: 10 });
    expect(t.tool_config.parameters).toEqual({ type: "object", properties: { query: { type: "string", description: "Key words or a short question to search for" } }, required: ["query"] });
  });
  it("builds the agent body per spec", () => {
    const a = agentBody("tool_1", ["pdfstudio.shemaiah7.workers.dev", "localhost"], true) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(a.name).toBe(AGENT_NAME);
    expect(a.conversation_config.agent.prompt).toMatchObject({ prompt: LIVE_INSTRUCTIONS, llm: "claude-sonnet-5-5", temperature: 0, tool_ids: ["tool_1"] });
    expect(a.conversation_config.agent.first_message).toBe("Ready. Ask me about the open document.");
    expect(a.conversation_config.tts).toEqual({ model_id: "eleven_v4_turbo", voice_id: "cjVigY5qzO86Huf0OWal" });
    expect(a.conversation_config.turn).toEqual({ turn_timeout: 7, turn_eagerness: "normal" });
    expect(a.conversation_config.conversation).toEqual({ max_duration_seconds: 600, client_events: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "client_tool_call"] });
    expect(a.platform_settings.auth).toEqual({ enable_auth: true, allowlist: [{ hostname: "pdfstudio.shemaiah7.workers.dev" }, { hostname: "localhost" }] });
    expect(a.platform_settings.privacy).toEqual({ record_voice: false, retention_days: 0, delete_transcript_and_pii: true, delete_audio: true, zero_retention_mode: true, apply_to_existing_conversations: true });
    expect((agentBody("t", [], false) as any).platform_settings.privacy.zero_retention_mode).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it("instructions mention the tool and the hands-free constraints", () => {
    expect(LIVE_INSTRUCTIONS).toContain("search_document");
    expect(LIVE_INSTRUCTIONS).toContain("two or three sentences");
  });
});

function fakeApi(opts: { tools?: any[]; agents?: any[]; rejectZero?: boolean } = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const api: ElApi = {
    async get(path) { calls.push({ m: "GET", path });
      if (path.startsWith("/v1/convai/tools")) return { status: 200, body: { tools: opts.tools ?? [] } };
      if (path.startsWith("/v1/convai/agents/")) return { status: 200, body: { agent_id: path.split("/").pop(), platform_settings: { privacy: { zero_retention_mode: !opts.rejectZero } } } };
      if (path.startsWith("/v1/convai/agents")) return { status: 200, body: { agents: opts.agents ?? [] } };
      return { status: 404, body: {} }; },
    async post(path, body) { calls.push({ m: "POST", path, body });
      if (path === "/v1/convai/tools") return { status: 200, body: { id: "tool_new" } };
      if (path === "/v1/convai/agents/create") { if (opts.rejectZero && (body as any).platform_settings.privacy.zero_retention_mode) return { status: 422, body: {} }; return { status: 200, body: { agent_id: "agent_new" } }; } // eslint-disable-line @typescript-eslint/no-explicit-any
      return { status: 404, body: {} }; },
    async patch(path, body) { calls.push({ m: "PATCH", path, body });
      if (opts.rejectZero && (body as any)?.platform_settings?.privacy?.zero_retention_mode) return { status: 422, body: {} }; // eslint-disable-line @typescript-eslint/no-explicit-any
      return { status: 200, body: {} }; },
  };
  return { api, calls };
}

describe("provisionAgent", () => {
  it("creates the tool and the agent when neither exists", async () => {
    const { api, calls } = fakeApi();
    const r = await provisionAgent(api, ["localhost"]);
    expect(r).toMatchObject({ agentId: "agent_new", toolId: "tool_new", zeroRetention: true });
    expect(calls.map((c) => `${c.m} ${c.path}`)).toEqual(["GET /v1/convai/tools", "POST /v1/convai/tools", "GET /v1/convai/agents?page_size=100", "POST /v1/convai/agents/create", "GET /v1/convai/agents/agent_new"]);
  });
  it("patches existing tool and agent found by name", async () => {
    const { api, calls } = fakeApi({ tools: [{ id: "tool_old", tool_config: { name: "search_document" } }], agents: [{ agent_id: "agent_old", name: "PDF Studio Voice" }] });
    const r = await provisionAgent(api, ["localhost"]);
    expect(r).toMatchObject({ agentId: "agent_old", toolId: "tool_old" });
    expect(calls.map((c) => `${c.m} ${c.path}`)).toContain("PATCH /v1/convai/tools/tool_old");
    expect(calls.map((c) => `${c.m} ${c.path}`)).toContain("PATCH /v1/convai/agents/agent_old");
  });
  it("retries without zero_retention_mode when the API rejects it", async () => {
    const { api, calls } = fakeApi({ rejectZero: true });
    const r = await provisionAgent(api, ["localhost"]);
    expect(r.zeroRetention).toBe(false);
    const creates = calls.filter((c) => c.path === "/v1/convai/agents/create");
    expect(creates).toHaveLength(2);
    expect((creates[1].body as any).platform_settings.privacy.zero_retention_mode).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix worker test -- test/provision.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write the config module**

```ts
// worker/src/prompts/live.ts
export const AGENT_NAME = "PDF Studio Voice";
export const SEARCH_TOOL_NAME = "search_document";
export const LIVE_LLM = "claude-sonnet-5-5";

export const LIVE_INSTRUCTIONS =
  "You are a voice assistant for a clinician reading a document in PDF Studio. You cannot see the document. " +
  "Before answering any question about its contents, call search_document with the key words of the question; you may call it more than once with different words. " +
  "Answer only from the passages it returns and cite the page. If nothing relevant comes back, say so briefly and offer to look again with different words. " +
  "Read numbers, units, dates, and names slowly and exactly as written. Do not give diagnoses or treatment advice beyond what the document states. " +
  "Keep answers to two or three sentences; the user is working hands-free.";

export function searchToolBody() {
  return {
    tool_config: {
      type: "client",
      name: SEARCH_TOOL_NAME,
      description: "Search the document the user has open and return the most relevant passages with page numbers. Call this before answering any question about the document's contents.",
      expects_response: true,
      response_timeout_secs: 10,
      parameters: { type: "object", properties: { query: { type: "string", description: "Key words or a short question to search for" } }, required: ["query"] },
    },
  };
}

export function agentBody(toolId: string, hostnames: string[], zeroRetention: boolean) {
  const privacy: Record<string, unknown> = { record_voice: false, retention_days: 0, delete_transcript_and_pii: true, delete_audio: true, apply_to_existing_conversations: true };
  if (zeroRetention) privacy.zero_retention_mode = true;
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: "Ready. Ask me about the open document.",
        language: "en",
        prompt: { prompt: LIVE_INSTRUCTIONS, llm: LIVE_LLM, temperature: 0, tool_ids: [toolId] },
      },
      tts: { model_id: "eleven_v4_turbo", voice_id: "cjVigY5qzO86Huf0OWal" },
      turn: { turn_timeout: 7, turn_eagerness: "normal" },
      conversation: { max_duration_seconds: 600, client_events: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "client_tool_call"] },
    },
    platform_settings: {
      auth: { enable_auth: true, allowlist: hostnames.map((hostname) => ({ hostname })) },
      privacy,
    },
  };
}
```

- [ ] **Step 4: Write the provisioning logic and the script**

```ts
// worker/src/provision.ts
import { AGENT_NAME, SEARCH_TOOL_NAME, agentBody, searchToolBody } from "./prompts/live";

export interface ElApi {
  get(path: string): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  post(path: string, body: unknown): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  patch(path: string, body: unknown): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const ok = (r: { status: number }) => r.status >= 200 && r.status < 300;

async function upsertTool(api: ElApi): Promise<string> {
  const list = await api.get("/v1/convai/tools");
  const existing = ok(list) ? (list.body?.tools as { id: string; tool_config?: { name?: string } }[] | undefined)?.find((t) => t.tool_config?.name === SEARCH_TOOL_NAME) : undefined;
  if (existing) {
    const r = await api.patch(`/v1/convai/tools/${existing.id}`, searchToolBody());
    if (!ok(r)) throw new Error(`tool patch failed: ${r.status}`);
    return existing.id;
  }
  const r = await api.post("/v1/convai/tools", searchToolBody());
  if (!ok(r) || typeof r.body?.id !== "string") throw new Error(`tool create failed: ${r.status}`);
  return r.body.id;
}

async function upsertAgent(api: ElApi, toolId: string, hostnames: string[]): Promise<{ agentId: string; zeroRetention: boolean }> {
  const list = await api.get("/v1/convai/agents?page_size=100");
  const existing = ok(list) ? (list.body?.agents as { agent_id: string; name?: string }[] | undefined)?.find((a) => a.name === AGENT_NAME) : undefined;
  for (const zero of [true, false]) {
    const body = agentBody(toolId, hostnames, zero);
    const r = existing ? await api.patch(`/v1/convai/agents/${existing.agent_id}`, body) : await api.post("/v1/convai/agents/create", body);
    if (ok(r)) return { agentId: existing ? existing.agent_id : String(r.body?.agent_id), zeroRetention: zero };
    if (r.status !== 422 && r.status !== 400 && r.status !== 403) throw new Error(`agent ${existing ? "patch" : "create"} failed: ${r.status}`);
  }
  throw new Error("agent create/patch rejected even without zero_retention_mode");
}

/** Creates or updates the search tool and the agent from the versioned config; returns what the API accepted. */
export async function provisionAgent(api: ElApi, hostnames: string[]): Promise<{ agentId: string; toolId: string; zeroRetention: boolean; privacy: unknown }> {
  const toolId = await upsertTool(api);
  const { agentId, zeroRetention } = await upsertAgent(api, toolId, hostnames);
  const check = await api.get(`/v1/convai/agents/${agentId}`);
  return { agentId, toolId, zeroRetention, privacy: check.body?.platform_settings?.privacy ?? null };
}
```

```ts
// worker/scripts/provision-agent.ts
// Run from the repo root: npx tsx worker/scripts/provision-agent.ts
// Reads ELEVENLABS_API_KEY from worker/.dev.vars; never prints it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { provisionAgent, type ElApi } from "../src/provision";

const vars = Object.fromEntries(readFileSync(resolve(process.cwd(), "worker/.dev.vars"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const key = vars.ELEVENLABS_API_KEY;
if (!key) { console.error("ELEVENLABS_API_KEY missing in worker/.dev.vars"); process.exit(1); }

const base = "https://api.elevenlabs.io";
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) console.error(`${method} ${path} -> ${res.status}`, JSON.stringify(json).slice(0, 400));
  return { status: res.status, body: json };
}
const api: ElApi = { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), patch: (p, b) => call("PATCH", p, b) };

const hostnames = (process.env.VOICE_HOSTNAMES ?? "pdfstudio.shemaiah7.workers.dev,localhost").split(",").map((h) => h.trim()).filter(Boolean);
const r = await provisionAgent(api, hostnames);
console.log(JSON.stringify({ agentId: r.agentId, toolId: r.toolId, zeroRetention: r.zeroRetention, privacy: r.privacy }, null, 2));
console.log(`\nNext: set "ELEVENLABS_AGENT_ID": "${r.agentId}" in worker/wrangler.jsonc vars and ELEVENLABS_AGENT_ID=${r.agentId} in worker/.dev.vars.`);
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm --prefix worker test -- test/provision.test.ts && npm --prefix worker run typecheck`
Expected: 6 passed; typecheck clean (the script is outside `worker/tsconfig.json` `include`, so it is checked only when run; add `"scripts"` to the tsconfig `include` array so it is typechecked too, and add `"types": ["node"]`-free code paths: the script uses only `node:fs`, `node:path`, `process`, `fetch`; if `process` is not typed under workers-types, declare `declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code: number): never };` at the top of the script).

- [ ] **Step 6: Commit**

```bash
git add worker/src/prompts/live.ts worker/src/provision.ts worker/scripts/provision-agent.ts worker/test/provision.test.ts worker/tsconfig.json
git commit -m "feat(worker): versioned ElevenLabs agent config and idempotent provisioning script"
```

---

### Task 5: Grounding helpers in the browser

**Files:**
- Create: `src/live/grounding.ts`
- Test: `src/live/grounding.test.ts`

**Interfaces:**
- Consumes: `queryTerms(q: string): string[]` from `src/search/ranker.ts`.
- Produces: `formatPassages(passages: { page: number; text: string }[], maxChars = 1500): string`, `keywordPassages(pages: { page: number; text: string }[], query: string, limit = 3): { page: number; text: string }[]`, `overview(name: string, pageCount: number, firstPageText: string): string`, `NO_MATCH = "No passage in the document matched that query."`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/live/grounding.test.ts
import { describe, it, expect } from "vitest";
import { formatPassages, keywordPassages, overview, NO_MATCH } from "./grounding";

describe("formatPassages", () => {
  it("prefixes each passage with its page and joins with blank lines", () => {
    expect(formatPassages([{ page: 2, text: "warfarin 5 mg" }, { page: 4, text: "INR 2.5" }])).toBe("[p. 2] warfarin 5 mg\n\n[p. 4] INR 2.5");
  });
  it("returns an empty string for no passages", () => { expect(formatPassages([])).toBe(""); });
  it("stops at a passage boundary before exceeding maxChars", () => {
    const out = formatPassages([{ page: 1, text: "a".repeat(40) }, { page: 2, text: "b".repeat(40) }, { page: 3, text: "c".repeat(40) }], 100);
    expect(out).toContain("[p. 1]"); expect(out).toContain("[p. 2]"); expect(out).not.toContain("[p. 3]");
  });
  it("truncates a single oversized passage", () => {
    expect(formatPassages([{ page: 1, text: "x".repeat(50) }], 20).length).toBeLessThanOrEqual(20);
  });
});

describe("keywordPassages", () => {
  const pages = [
    { page: 1, text: "Cardiology note. Troponin elevated. Aspirin given." },
    { page: 2, text: "Dermatology note. Rash on forearm after gardening. Topical corticosteroid prescribed." },
    { page: 3, text: "Follow-up: rash improved; continue corticosteroid for one week." },
  ];
  it("ranks pages by distinct term hits and windows around the first hit", () => {
    const r = keywordPassages(pages, "corticosteroid rash");
    expect(r.map((p) => p.page)).toEqual([2, 3]);
    expect(r[0].text).toContain("Rash on forearm");
  });
  it("returns an empty list when nothing matches or the query has no terms", () => {
    expect(keywordPassages(pages, "zzzz")).toEqual([]);
    expect(keywordPassages(pages, "the and")).toEqual([]);
  });
  it("limits results and windows to 600 characters", () => {
    const long = { page: 9, text: "filler ".repeat(200) + "troponin " + "filler ".repeat(200) };
    const r = keywordPassages([long, ...pages], "troponin", 1);
    expect(r).toHaveLength(1);
    expect(r[0].text.length).toBeLessThanOrEqual(600);
    expect(r[0].text).toContain("troponin");
  });
});

describe("overview", () => {
  it("names the document, page count and the first 300 characters", () => {
    const o = overview("note.pdf", 7, "x".repeat(400));
    expect(o.startsWith("Document: note.pdf, 7 pages. Begins: ")).toBe(true);
    expect(o.length).toBe("Document: note.pdf, 7 pages. Begins: ".length + 300);
  });
  it("exports the no-match string", () => { expect(NO_MATCH).toBe("No passage in the document matched that query."); });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/live/grounding.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/live/grounding.ts
import { queryTerms } from "../search/ranker";

export const NO_MATCH = "No passage in the document matched that query.";

/** "[p. N] text" blocks joined by blank lines, cut at a passage boundary so the result stays within maxChars. */
export function formatPassages(passages: { page: number; text: string }[], maxChars = 1500): string {
  const blocks: string[] = [];
  let used = 0;
  for (const p of passages) {
    const block = `[p. ${p.page}] ${p.text.trim()}`;
    const sep = blocks.length ? 2 : 0;
    if (used + sep + block.length > maxChars) {
      if (blocks.length === 0) blocks.push(block.slice(0, maxChars));
      break;
    }
    blocks.push(block);
    used += sep + block.length;
  }
  return blocks.join("\n\n");
}

/** Fallback when the embedding model is not available: pages ranked by distinct query-term hits, 600-char window around the first hit. */
export function keywordPassages(pages: { page: number; text: string }[], query: string, limit = 3): { page: number; text: string }[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const scored: { page: number; text: string; hits: number; first: number }[] = [];
  for (const p of pages) {
    const lower = p.text.toLowerCase();
    let hits = 0; let first = -1;
    for (const t of terms) {
      const i = lower.indexOf(t);
      if (i >= 0) { hits++; if (first < 0 || i < first) first = i; }
    }
    if (hits > 0) scored.push({ page: p.page, text: p.text, hits, first });
  }
  scored.sort((a, b) => b.hits - a.hits || a.page - b.page);
  return scored.slice(0, limit).map((s) => {
    const start = Math.max(0, s.first - 200);
    return { page: s.page, text: s.text.slice(start, start + 600).trim() };
  });
}

export function overview(name: string, pageCount: number, firstPageText: string): string {
  return `Document: ${name}, ${pageCount} pages. Begins: ${firstPageText.replace(/\s+/g, " ").trim().slice(0, 300)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/live/grounding.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/live/grounding.ts src/live/grounding.test.ts
git commit -m "feat(live): passage formatting, keyword fallback and document overview for voice grounding"
```

---

### Task 6: `LiveClient` wrapper over `@elevenlabs/client`

**Files:**
- Create: `src/live/liveClient.ts`
- Modify: `package.json` (dependency `@elevenlabs/client` `1.27.0`, exact)
- Test: `src/live/liveClient.test.ts`

**Interfaces:**
- Consumes: `@elevenlabs/client` `Conversation.startSession`.
- Produces:
```ts
export interface LiveEvents { onConnected(): void; onUserText(text: string): void; onAgentText(text: string): void; onAgentCorrection(text: string): void; onInterruption(): void; onError(message: string): void; onDisconnected(reason: "user" | "agent" | "error", message?: string): void }
export interface LiveTransport { createSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number; resetAt: number }> }
export type SearchTool = (query: string) => Promise<string>
export type StartSession = (opts: Record<string, unknown>) => Promise<LiveConversation>
export interface LiveConversation { endSession(): Promise<void>; sendContextualUpdate(text: string): void; setMicMuted(muted: boolean): void; getId(): string }
export class LiveClient {
  constructor(transport: LiveTransport, events: LiveEvents, search: SearchTool, deps?: { startSession?: StartSession; connectTimeoutMs?: number; closeTimeoutMs?: number })
  start(): Promise<{ remainingSeconds: number }>
  sendContext(text: string): void
  mute(on: boolean): void
  close(): Promise<void>
  readonly conversationId: string | null
}
```

- [ ] **Step 1: Install the SDK**

Run: `npm install --save-exact @elevenlabs/client@1.27.0`
Expected: `package.json` dependencies gain `"@elevenlabs/client": "1.27.0"`; lockfile updated.

- [ ] **Step 2: Write the failing tests**

```ts
// src/live/liveClient.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { LiveClient, type LiveEvents, type LiveConversation, type StartSession } from "./liveClient";

type Opts = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function fakeSdk(behaviour: { connect?: boolean; disconnectOnEnd?: boolean; throwOnStart?: Error } = {}) {
  let opts: Opts = {};
  const conv: LiveConversation & { ended: boolean; context: string[]; muted: boolean | null } = {
    ended: false, context: [], muted: null,
    async endSession() { this.ended = true; if (behaviour.disconnectOnEnd !== false) opts.onDisconnect?.({ reason: "user" }); },
    sendContextualUpdate(t) { this.context.push(t); },
    setMicMuted(m) { this.muted = m; },
    getId: () => "conv_1",
  };
  const startSession: StartSession = async (o) => {
    opts = o;
    if (behaviour.throwOnStart) throw behaviour.throwOnStart;
    if (behaviour.connect !== false) queueMicrotask(() => opts.onConnect?.());
    return conv;
  };
  return { startSession, conv, opts: () => opts };
}
const transport = { createSession: async () => ({ conversationId: "conv_1", token: "tok", remainingSeconds: 1200, resetAt: 0 }) };
const events = (): LiveEvents & Record<string, ReturnType<typeof vi.fn>> => ({ onConnected: vi.fn(), onUserText: vi.fn(), onAgentText: vi.fn(), onAgentCorrection: vi.fn(), onInterruption: vi.fn(), onError: vi.fn(), onDisconnected: vi.fn() });

describe("LiveClient", () => {
  it("starts with the token over WebRTC, registers the tool, resolves on connect", async () => {
    const sdk = fakeSdk(); const ev = events();
    const search = vi.fn(async (q: string) => `[p. 1] ${q}`);
    const c = new LiveClient(transport, ev, search, { startSession: sdk.startSession });
    const r = await c.start();
    expect(r).toEqual({ remainingSeconds: 1200 });
    expect(sdk.opts()).toMatchObject({ conversationToken: "tok", connectionType: "webrtc" });
    expect(c.conversationId).toBe("conv_1");
    expect(ev.onConnected).toHaveBeenCalledTimes(1);
    expect(await sdk.opts().clientTools.search_document({ query: "warfarin" })).toBe("[p. 1] warfarin");
    expect(search).toHaveBeenCalledWith("warfarin");
  });
  it("routes messages by role and forwards corrections and interruptions", async () => {
    const sdk = fakeSdk(); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession });
    await c.start();
    sdk.opts().onMessage({ role: "user", source: "user", message: "hello", event_id: 1 });
    sdk.opts().onMessage({ role: "agent", source: "ai", message: "hi there", event_id: 2 });
    sdk.opts().onAgentResponseCorrection({ original_agent_response: "hi there", corrected_agent_response: "hi" });
    sdk.opts().onInterruption({ event_id: 3 });
    expect(ev.onUserText).toHaveBeenCalledWith("hello");
    expect(ev.onAgentText).toHaveBeenCalledWith("hi there");
    expect(ev.onAgentCorrection).toHaveBeenCalledWith("hi");
    expect(ev.onInterruption).toHaveBeenCalledTimes(1);
  });
  it("forwards context, mute and error", async () => {
    const sdk = fakeSdk(); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession });
    await c.start();
    c.sendContext("Document: x"); c.mute(true);
    expect(sdk.conv.context).toEqual(["Document: x"]); expect(sdk.conv.muted).toBe(true);
    sdk.opts().onError("boom");
    expect(ev.onError).toHaveBeenCalledWith("boom");
  });
  it("close ends the session and resolves on disconnect; disconnect maps reasons", async () => {
    const sdk = fakeSdk(); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession });
    await c.start();
    await c.close();
    expect(sdk.conv.ended).toBe(true);
    expect(ev.onDisconnected).toHaveBeenCalledWith("user", undefined);
    sdk.opts().onDisconnect({ reason: "error", message: "lost", context: { type: "x" } });
    expect(ev.onDisconnected).toHaveBeenLastCalledWith("error", "lost");
  });
  it("close resolves after the timeout when no disconnect arrives", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk({ disconnectOnEnd: false }); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession, closeTimeoutMs: 50 });
    await c.start();
    const p = c.close();
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(sdk.conv.ended).toBe(true);
    vi.useRealTimers();
  });
  it("start rejects when the SDK throws (mic denied) and when connect times out", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    await expect(new LiveClient(transport, events(), async () => "", { startSession: fakeSdk({ throwOnStart: denied }).startSession }).start()).rejects.toMatchObject({ name: "NotAllowedError" });
    vi.useFakeTimers();
    const sdk = fakeSdk({ connect: false });
    const p = new LiveClient(transport, events(), async () => "", { startSession: sdk.startSession, connectTimeoutMs: 100 }).start();
    const assertion = expect(p).rejects.toThrow("connect_timeout");
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(sdk.conv.ended).toBe(true);
    vi.useRealTimers();
  });
  it("the tool never throws: errors and slow searches become the no-match string", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk();
    const slow = () => new Promise<string>(() => {});
    const c = new LiveClient(transport, events(), slow, { startSession: sdk.startSession });
    await c.start();
    const p = sdk.opts().clientTools.search_document({ query: "x" });
    await vi.advanceTimersByTimeAsync(8_100);
    expect(await p).toBe("No passage in the document matched that query.");
    vi.useRealTimers();
    const c2 = new LiveClient(transport, events(), async () => { throw new Error("bad"); }, { startSession: sdk.startSession });
    await c2.start();
    expect(await sdk.opts().clientTools.search_document({ query: "x" })).toBe("No passage in the document matched that query.");
    expect(await sdk.opts().clientTools.search_document({})).toBe("No passage in the document matched that query.");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/live/liveClient.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// src/live/liveClient.ts
import { NO_MATCH } from "./grounding";

export interface LiveEvents {
  onConnected(): void;
  onUserText(text: string): void;
  onAgentText(text: string): void;
  onAgentCorrection(text: string): void;
  onInterruption(): void;
  onError(message: string): void;
  onDisconnected(reason: "user" | "agent" | "error", message?: string): void;
}
export interface LiveTransport { createSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number; resetAt: number }> }
export type SearchTool = (query: string) => Promise<string>;
export interface LiveConversation { endSession(): Promise<void>; sendContextualUpdate(text: string): void; setMicMuted(muted: boolean): void; getId(): string }
export type StartSession = (opts: Record<string, unknown>) => Promise<LiveConversation>;

export const TOOL_TIMEOUT_MS = 8_000;

/** Lazily imports the SDK so the voice bundle only loads when a session starts. */
const sdkStartSession: StartSession = async (opts) => {
  const { Conversation } = await import("@elevenlabs/client");
  return (await Conversation.startSession(opts as never)) as unknown as LiveConversation;
};

export class LiveClient {
  private conv: LiveConversation | null = null;
  private disconnected = false;
  private onDisconnectResolve: (() => void) | null = null;
  conversationId: string | null = null;
  private readonly startSession: StartSession;
  private readonly connectTimeoutMs: number;
  private readonly closeTimeoutMs: number;

  constructor(private transport: LiveTransport, private events: LiveEvents, private search: SearchTool, deps: { startSession?: StartSession; connectTimeoutMs?: number; closeTimeoutMs?: number } = {}) {
    this.startSession = deps.startSession ?? sdkStartSession;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? 15_000;
    this.closeTimeoutMs = deps.closeTimeoutMs ?? 5_000;
  }

  async start(): Promise<{ remainingSeconds: number }> {
    const session = await this.transport.createSession();
    this.conversationId = session.conversationId;
    let connected: () => void = () => {};
    const connectedP = new Promise<void>((r) => { connected = r; });
    const tool = async (params: unknown): Promise<string> => {
      const query = typeof (params as { query?: unknown })?.query === "string" ? (params as { query: string }).query : "";
      if (!query.trim()) return NO_MATCH;
      try {
        const result = await Promise.race([this.search(query), new Promise<string>((r) => setTimeout(() => r(NO_MATCH), TOOL_TIMEOUT_MS))]);
        return result.trim() ? result : NO_MATCH;
      } catch { return NO_MATCH; }
    };
    this.conv = await this.startSession({
      conversationToken: session.token,
      connectionType: "webrtc",
      clientTools: { search_document: tool },
      onConnect: () => { connected(); this.events.onConnected(); },
      onDisconnect: (d: { reason: "user" | "agent" | "error"; message?: string }) => {
        this.disconnected = true;
        this.onDisconnectResolve?.();
        this.events.onDisconnected(d.reason, d.reason === "error" ? d.message : undefined);
      },
      onError: (message: string) => this.events.onError(message),
      onMessage: (m: { role?: "user" | "agent"; source?: "user" | "ai"; message: string }) => {
        const role = m.role ?? (m.source === "ai" ? "agent" : "user");
        if (role === "user") this.events.onUserText(m.message); else this.events.onAgentText(m.message);
      },
      onAgentResponseCorrection: (c: { corrected_agent_response: string }) => this.events.onAgentCorrection(c.corrected_agent_response),
      onInterruption: () => this.events.onInterruption(),
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("connect_timeout")), this.connectTimeoutMs); });
    try { await Promise.race([connectedP, timeout]); } catch (err) { await this.close(); throw err; } finally { if (timer) clearTimeout(timer); }
    return { remainingSeconds: session.remainingSeconds };
  }

  sendContext(text: string): void { this.conv?.sendContextualUpdate(text); }
  mute(on: boolean): void { this.conv?.setMicMuted(on); }

  /** Ends the session; resolves when the SDK reports the disconnect or after closeTimeoutMs. */
  async close(): Promise<void> {
    const conv = this.conv;
    if (!conv) return;
    this.conv = null;
    if (this.disconnected) return;
    const gone = new Promise<void>((r) => { this.onDisconnectResolve = r; });
    const timer = new Promise<void>((r) => setTimeout(r, this.closeTimeoutMs));
    try { await conv.endSession(); } catch { /* already closed */ }
    await Promise.race([gone, timer]);
  }
}
```

- [ ] **Step 5: Run the tests and the root typecheck**

Run: `npx vitest run src/live/liveClient.test.ts && npx tsc -b`
Expected: 7 passed; typecheck clean. If `Conversation.startSession(opts as never)` fails to type, cast the options to `Parameters<typeof Conversation.startSession>[0]`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/live/liveClient.ts src/live/liveClient.test.ts
git commit -m "feat(live): LiveClient wrapper over @elevenlabs/client with a never-throwing search tool"
```

---

### Task 7: Live store with grounding, timers, usage reporting

**Files:**
- Create: `src/store/live.ts`
- Modify: `src/ai/client.ts` (add `createLiveSession`, `reportLiveUsage`)
- Test: `src/store/live.test.ts`, `src/ai/client.test.ts` (two cases)

**Interfaces:**
- Consumes: Task 5 (`formatPassages`, `keywordPassages`, `overview`, `NO_MATCH`), Task 6 (`LiveClient`, `LiveEvents`, `StartSession`), `retrievePassages(question, limit)` from `src/store/search.ts` (returns `{page,text}[] | null | "indexing"`), `documentText("all")` from `src/pdf/text.ts`, `useDocumentStore`, `useAiStore.getState().client` (an `AiClient`).
- Produces: `AiClient.createLiveSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number; resetAt: number }>` (throws `Error` with message code and `.resetAt`), `AiClient.reportLiveUsage(conversationId: string, seconds: number, keepalive = false): Promise<{ remainingSeconds: number } | null>`; `useLiveStore` with:
```ts
export interface LiveState {
  status: "idle" | "connecting" | "live" | "ending" | "error";
  error: string | null;
  captions: { role: "you" | "assistant"; text: string }[];
  seconds: number; remainingSeconds: number | null; resetAt: number | null;
  muted: boolean; acknowledged: boolean; searching: boolean; keywordMode: boolean;
  conversationId: string | null;
  start(): Promise<void>; end(): Promise<void>; setMuted(on: boolean): void; acknowledge(): void;
}
export interface LiveDeps { retrieve: typeof retrievePassages; documentText: typeof documentText; startSession?: StartSession; getMedia: () => Promise<void>; now: () => number }
export function configureLiveDeps(partial: Partial<LiveDeps>): void
export const SESSION_CAP_S = 600; export const SILENCE_S = 120;
```

- [ ] **Step 1: Write the failing client tests** (append inside `describe("AiClient")` in `src/ai/client.test.ts`)

```ts
  it("createLiveSession posts /live with the bearer and maps errors", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ token: "t1", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(json({ conversationId: "c", token: "el", remainingSeconds: 1200, resetAt: 5 }, 200))
      .mockResolvedValueOnce(json({ error: "voice_limit", resetAt: 99 }, 429));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn });
    expect(await c.createLiveSession()).toEqual({ conversationId: "c", token: "el", remainingSeconds: 1200, resetAt: 5 });
    expect(fetchFn.mock.calls[1][0]).toBe("https://ai.test/live");
    expect((fetchFn.mock.calls[1][1] as RequestInit).headers).toMatchObject({ authorization: "Bearer t1" });
    await expect(c.createLiveSession()).rejects.toMatchObject({ message: "voice_limit", resetAt: 99 });
  });
  it("reportLiveUsage posts the body with keepalive and returns null on failure", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ token: "t1", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(json({ remainingSeconds: 1700 }, 200))
      .mockRejectedValueOnce(new Error("net"));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn });
    expect(await c.reportLiveUsage("c", 95, true)).toEqual({ remainingSeconds: 1700 });
    const init = fetchFn.mock.calls[1][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: "c", seconds: 95 });
    expect(await c.reportLiveUsage("c", 95)).toBeNull();
  });
```

- [ ] **Step 2: Implement the client methods** (add to `AiClient` in `src/ai/client.ts`)

```ts
  async createLiveSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number; resetAt: number }> {
    let token: string;
    try { token = await this.ensureSession(); } catch { throw new Error("verification_failed"); }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try { res = await this.fetchFn(`${this.baseUrl}/live`, { method: "POST", headers: { authorization: `Bearer ${token}` } }); } catch { throw new Error("network"); }
      if (res.status === 401 && attempt === 0) { try { token = await this.ensureSession(true); continue; } catch { throw new Error("verification_failed"); } }
      if (!res.ok) { const err = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: number }; throw Object.assign(new Error(err.error ?? "upstream"), { resetAt: err.resetAt }); }
      return (await res.json()) as { conversationId: string; token: string; remainingSeconds: number; resetAt: number };
    }
    throw new Error("upstream");
  }

  /** Best effort: never throws. keepalive lets the report survive page unload. */
  async reportLiveUsage(conversationId: string, seconds: number, keepalive = false): Promise<{ remainingSeconds: number } | null> {
    try {
      const token = await this.ensureSession();
      const res = await this.fetchFn(`${this.baseUrl}/live/usage`, { method: "POST", keepalive, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ conversationId, seconds: Math.max(0, Math.min(600, Math.round(seconds))) }) });
      if (!res.ok) return null;
      return (await res.json()) as { remainingSeconds: number };
    } catch { return null; }
  }
```

Run: `npx vitest run src/ai/client.test.ts` — Expected: all pass.

- [ ] **Step 3: Write the failing store tests**

```ts
// src/store/live.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useDocumentStore } from "./document";
import { useAiStore } from "./ai";
import { useLiveStore, configureLiveDeps, SESSION_CAP_S, SILENCE_S } from "./live";
import type { LiveConversation, StartSession } from "../live/liveClient";

type Opts = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let opts: Opts = {};
const conv: LiveConversation & { ended: boolean; context: string[] } = {
  ended: false, context: [],
  async endSession() { this.ended = true; queueMicrotask(() => opts.onDisconnect?.({ reason: "user" })); },
  sendContextualUpdate(t) { this.context.push(t); }, setMicMuted() {}, getId: () => "conv_1",
};
const startSession: StartSession = async (o) => { opts = o; queueMicrotask(() => opts.onConnect?.()); return conv; };
const client = { createLiveSession: vi.fn(), reportLiveUsage: vi.fn() };
const retrieve = vi.fn();
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

function openDoc(id = "s1") {
  useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map([[id, { id, name: "note.pdf", bytes: new Uint8Array(), pageCount: 2, hash: "h" }]]), pages: [{ id: `${id}-0`, sourceId: id, sourcePageIndex: 0, rotation: 0 }, { id: `${id}-1`, sourceId: id, sourcePageIndex: 1, rotation: 0 }] });
}

beforeEach(() => {
  vi.useFakeTimers();
  conv.ended = false; conv.context = []; opts = {};
  client.createLiveSession.mockReset().mockResolvedValue({ conversationId: "conv_1", token: "tok", remainingSeconds: 1200, resetAt: 0 });
  client.reportLiveUsage.mockReset().mockResolvedValue({ remainingSeconds: 1705 });
  retrieve.mockReset().mockResolvedValue([{ page: 2, text: "warfarin 5 mg nightly" }]);
  useAiStore.setState({ client: client as never });
  configureLiveDeps({ retrieve: retrieve as never, documentText: async () => [{ page: 1, text: "Cardiology note. Troponin elevated." }, { page: 2, text: "warfarin 5 mg nightly" }], startSession, getMedia: async () => {}, now: () => Date.now() });
  useLiveStore.setState({ status: "idle", error: null, captions: [], seconds: 0, remainingSeconds: null, resetAt: null, muted: false, acknowledged: true, searching: false, keywordMode: false, conversationId: null });
  openDoc();
});
afterEach(() => { vi.useRealTimers(); });

describe("useLiveStore", () => {
  it("start: mic check, /live, connect, overview context, live", async () => {
    await useLiveStore.getState().start();
    await flush();
    const s = useLiveStore.getState();
    expect(s.status).toBe("live");
    expect(s.conversationId).toBe("conv_1");
    expect(s.remainingSeconds).toBe(1200);
    expect(conv.context[0]).toMatch(/^Document: note\.pdf, 2 pages\. Begins: Cardiology note/);
  });
  it("mic denied: error, no /live call, no usage report", async () => {
    configureLiveDeps({ getMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } });
    await useLiveStore.getState().start();
    expect(useLiveStore.getState()).toMatchObject({ status: "error", error: "Microphone access is needed for voice." });
    expect(client.createLiveSession).not.toHaveBeenCalled();
    expect(client.reportLiveUsage).not.toHaveBeenCalled();
  });
  it("voice_limit maps to the reset-time message", async () => {
    client.createLiveSession.mockRejectedValueOnce(Object.assign(new Error("voice_limit"), { resetAt: 1_900_000_000 }));
    await useLiveStore.getState().start();
    expect(useLiveStore.getState().error).toMatch(/^Voice allowance used for today; resets at /);
    expect(useLiveStore.getState().status).toBe("error");
  });
  it("voice_unavailable maps to its message", async () => {
    client.createLiveSession.mockRejectedValueOnce(new Error("voice_unavailable"));
    await useLiveStore.getState().start();
    expect(useLiveStore.getState().error).toBe("Voice service unavailable right now.");
  });
  it("search tool uses retrieval when ready and formats passages; keyword fallback otherwise", async () => {
    await useLiveStore.getState().start(); await flush();
    expect(await opts.clientTools.search_document({ query: "warfarin" })).toBe("[p. 2] warfarin 5 mg nightly");
    expect(useLiveStore.getState().keywordMode).toBe(false);
    retrieve.mockResolvedValueOnce(null);
    expect(await opts.clientTools.search_document({ query: "troponin" })).toContain("[p. 1] Cardiology note. Troponin elevated.");
    expect(useLiveStore.getState().keywordMode).toBe(true);
    retrieve.mockResolvedValueOnce("indexing");
    expect(await opts.clientTools.search_document({ query: "warfarin" })).toContain("[p. 2]");
    retrieve.mockResolvedValueOnce([]);
    expect(await opts.clientTools.search_document({ query: "zzzz" })).toBe("No passage in the document matched that query.");
    expect(useLiveStore.getState().searching).toBe(false);
  });
  it("captions: user and assistant messages, corrections replace the last assistant caption", async () => {
    await useLiveStore.getState().start(); await flush();
    opts.onMessage({ role: "user", message: "what dose", event_id: 1 });
    opts.onMessage({ role: "agent", message: "Five milligrams nightly, page 2.", event_id: 2 });
    opts.onAgentResponseCorrection({ original_agent_response: "Five milligrams nightly, page 2.", corrected_agent_response: "Five milligrams" });
    expect(useLiveStore.getState().captions).toEqual([{ role: "you", text: "what dose" }, { role: "assistant", text: "Five milligrams" }]);
  });
  it("end: closes, reports usage with elapsed seconds, updates remaining, keeps captions", async () => {
    await useLiveStore.getState().start(); await flush();
    opts.onMessage({ role: "user", message: "hi", event_id: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    await useLiveStore.getState().end(); await flush();
    expect(conv.ended).toBe(true);
    expect(client.reportLiveUsage).toHaveBeenCalledWith("conv_1", 5, false);
    expect(useLiveStore.getState()).toMatchObject({ status: "idle", remainingSeconds: 1705, captions: [{ role: "you", text: "hi" }] });
  });
  it("session cap and silence timer end the session", async () => {
    await useLiveStore.getState().start(); await flush();
    await vi.advanceTimersByTimeAsync(SILENCE_S * 1000 - 1000);
    opts.onMessage({ role: "user", message: "still here", event_id: 1 });   // resets silence
    await vi.advanceTimersByTimeAsync(SILENCE_S * 1000 - 1000);
    expect(useLiveStore.getState().status).toBe("live");
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(useLiveStore.getState().status).toBe("idle");
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);

    client.reportLiveUsage.mockClear();
    await useLiveStore.getState().start(); await flush();
    for (let t = 0; t < SESSION_CAP_S; t += 60) { opts.onInterruption?.(); await vi.advanceTimersByTimeAsync(60_000); }
    await flush();
    expect(useLiveStore.getState().status).toBe("idle");
    expect(client.reportLiveUsage).toHaveBeenCalledWith("conv_1", SESSION_CAP_S, false);
  });
  it("remote disconnect with error shows Connection lost and reports usage once", async () => {
    await useLiveStore.getState().start(); await flush();
    await vi.advanceTimersByTimeAsync(3000);
    opts.onDisconnect({ reason: "error", message: "ice failed", context: { type: "x" } }); await flush();
    expect(useLiveStore.getState()).toMatchObject({ status: "error", error: "Connection lost" });
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);
    expect(client.reportLiveUsage).toHaveBeenCalledWith("conv_1", 3, false);
  });
  it("agent-initiated close shows Session ended", async () => {
    await useLiveStore.getState().start(); await flush();
    opts.onDisconnect({ reason: "agent" }); await flush();
    expect(useLiveStore.getState()).toMatchObject({ status: "idle", error: "Session ended" });
  });
  it("document change while live ends the session", async () => {
    await useLiveStore.getState().start(); await flush();
    openDoc("s2"); await flush();
    expect(conv.ended).toBe(true);
    await flush();
    expect(useLiveStore.getState().status).toBe("idle");
  });
  it("setMuted forwards to the client", async () => {
    const spy = vi.spyOn(conv, "setMicMuted");
    await useLiveStore.getState().start(); await flush();
    useLiveStore.getState().setMuted(true);
    expect(spy).toHaveBeenCalledWith(true);
    expect(useLiveStore.getState().muted).toBe(true);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/store/live.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement the store**

```ts
// src/store/live.ts
import { create } from "zustand";
import { LiveClient, type StartSession } from "../live/liveClient";
import { formatPassages, keywordPassages, overview, NO_MATCH } from "../live/grounding";
import { retrievePassages } from "./search";
import { documentText } from "../pdf/text";
import { useDocumentStore } from "./document";
import { useAiStore } from "./ai";

export const SESSION_CAP_S = 600;
export const SILENCE_S = 120;

export interface LiveState {
  status: "idle" | "connecting" | "live" | "ending" | "error";
  error: string | null;
  captions: { role: "you" | "assistant"; text: string }[];
  seconds: number;
  remainingSeconds: number | null;
  resetAt: number | null;
  muted: boolean;
  acknowledged: boolean;
  searching: boolean;
  keywordMode: boolean;
  conversationId: string | null;
  start(): Promise<void>;
  end(): Promise<void>;
  setMuted(on: boolean): void;
  acknowledge(): void;
}

export interface LiveDeps {
  retrieve: typeof retrievePassages;
  documentText: typeof documentText;
  startSession?: StartSession;
  getMedia: () => Promise<void>;
  now: () => number;
}
const deps: LiveDeps = {
  retrieve: retrievePassages,
  documentText,
  getMedia: async () => { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); for (const t of s.getTracks()) t.stop(); },
  now: () => Date.now(),
};
export function configureLiveDeps(partial: Partial<LiveDeps>): void { Object.assign(deps, partial); }

const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function errorMessage(code: string, resetAt?: number): string {
  switch (code) {
    case "voice_limit": return `Voice allowance used for today; resets at ${resetAt ? fmtTime(resetAt) : "midnight UTC"}.`;
    case "voice_unavailable": return "Voice service unavailable right now.";
    case "verification_failed": return "Verification failed. Reload the page and try again.";
    case "network": case "connect_timeout": return "Connection lost";
    default: return "Voice could not start.";
  }
}

let client: LiveClient | null = null;
let startedAt = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
let silence: ReturnType<typeof setTimeout> | null = null;
let reported = false;

export const useLiveStore = create<LiveState>((set, get) => {
  const clearTimers = () => { if (ticker) clearInterval(ticker); ticker = null; if (silence) clearTimeout(silence); silence = null; };
  const elapsed = () => (startedAt === 0 ? 0 : Math.min(SESSION_CAP_S, Math.round((deps.now() - startedAt) / 1000)));
  const armSilence = () => { if (silence) clearTimeout(silence); silence = setTimeout(() => { void get().end(); }, SILENCE_S * 1000); };

  const report = async (keepalive = false) => {
    const id = get().conversationId;
    if (!id || reported) return;
    reported = true;
    const api = useAiStore.getState().client;
    const r = await api?.reportLiveUsage(id, elapsed(), keepalive);
    if (r) set({ remainingSeconds: r.remainingSeconds });
  };

  const search = async (query: string): Promise<string> => {
    set({ searching: true });
    try {
      let passages: { page: number; text: string }[] | null = null;
      try { const r = await deps.retrieve(query, 4); if (Array.isArray(r) && r.length > 0) passages = r; } catch { passages = null; }
      if (!passages) {
        set({ keywordMode: true });
        passages = keywordPassages(await deps.documentText("all"), query);
      }
      return passages.length ? formatPassages(passages) : NO_MATCH;
    } finally { set({ searching: false }); }
  };

  const finish = (status: "idle" | "error", error: string | null) => {
    clearTimers();
    client = null;
    set({ status, error, searching: false, muted: false });
  };

  return {
    status: "idle", error: null, captions: [], seconds: 0, remainingSeconds: null, resetAt: null,
    muted: false, acknowledged: false, searching: false, keywordMode: false, conversationId: null,
    acknowledge: () => set({ acknowledged: true }),
    setMuted: (on) => { client?.mute(on); set({ muted: on }); },

    async start() {
      if (get().status !== "idle" && get().status !== "error") return;
      const api = useAiStore.getState().client;
      if (!api) { set({ status: "error", error: "Voice could not start." }); return; }
      set({ status: "connecting", error: null, captions: [], seconds: 0, searching: false, keywordMode: false, conversationId: null });
      startedAt = 0;
      try { await deps.getMedia(); } catch { set({ status: "error", error: "Microphone access is needed for voice." }); return; }
      reported = false;
      const live = new LiveClient(
        { createSession: async () => { const s = await api.createLiveSession(); set({ conversationId: s.conversationId, resetAt: s.resetAt }); return s; } },
        {
          onConnected: () => {
            const doc = useDocumentStore.getState();
            const src = doc.sources.get(doc.pages[0]?.sourceId ?? "");
            void deps.documentText("all").then((pages) => { if (client === live) live.sendContext(overview(src?.name ?? "document", doc.pages.length, pages[0]?.text ?? "")); });
          },
          onUserText: (text) => { armSilence(); set({ captions: [...get().captions, { role: "you", text }] }); },
          onAgentText: (text) => { armSilence(); set({ captions: [...get().captions, { role: "assistant", text }] }); },
          onAgentCorrection: (text) => {
            const c = [...get().captions];
            for (let i = c.length - 1; i >= 0; i--) if (c[i].role === "assistant") { c[i] = { role: "assistant", text }; break; }
            set({ captions: c });
          },
          onInterruption: () => armSilence(),
          onError: (m) => console.warn("voice:", m),
          onDisconnected: (reason) => {
            if (client !== live || get().status === "ending") return; // end() owns the user-initiated path
            void report();
            if (reason === "error") finish("error", "Connection lost");
            else finish("idle", "Session ended");
          },
        },
        search,
        deps.startSession ? { startSession: deps.startSession } : {},
      );
      client = live;
      try {
        const { remainingSeconds } = await live.start();
        if (client !== live) return;
        startedAt = deps.now();
        set({ status: "live", remainingSeconds, seconds: 0 });
        ticker = setInterval(() => {
          set({ seconds: elapsed() });
          if (elapsed() >= SESSION_CAP_S) void get().end();
        }, 1000);
        armSilence();
      } catch (err) {
        const e = err as Error & { resetAt?: number };
        const code = e.name === "NotAllowedError" || e.name === "NotFoundError" ? "mic" : e.message;
        if (get().conversationId) void report();
        finish("error", code === "mic" ? "Microphone access is needed for voice." : errorMessage(code, e.resetAt));
      }
    },

    async end() {
      const live = client;
      if (!live || get().status === "ending") return;
      set({ status: "ending" });
      await live.close();
      if (client !== live) return; // a remote disconnect already finished the session
      await report();
      finish("idle", "Session ended");
    },
  };
});

// Document change while live ends the session.
useDocumentStore.subscribe((s, prev) => {
  if (s.sources === prev.sources) return;
  const st = useLiveStore.getState();
  if (st.status === "live" || st.status === "connecting") void st.end();
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const st = useLiveStore.getState();
    if (st.status !== "live") return;
    const api = useAiStore.getState().client;
    if (st.conversationId && api && !reported) { reported = true; void api.reportLiveUsage(st.conversationId, st.seconds, true); }
    client?.close().catch(() => {});
  });
}
```

- [ ] **Step 6: Run the tests and typecheck; fix to spec**

Run: `npx vitest run src/store/live.test.ts src/ai/client.test.ts && npx tsc -b`
Expected: all pass, typecheck clean. Notes for the implementer: `end()` owns the user-initiated path (`onDisconnected` returns early while status is `ending`), remote closes report from `onDisconnected`, and `reported` guards against double reporting from `pagehide`; the cap test expects `SESSION_CAP_S` because `elapsed()` is clamped. A session that failed before connecting reports 0 s because `startedAt` is 0. If the "session cap" assertion sees 599 or 601 because of timer ordering, compute `elapsed()` from `deps.now()` only (already the case) and make sure `startedAt` is set before the ticker starts.

- [ ] **Step 7: Commit**

```bash
git add src/store/live.ts src/store/live.test.ts src/ai/client.ts src/ai/client.test.ts
git commit -m "feat(live): voice session store with pull grounding, timers, and usage reporting"
```

---

### Task 8: Voice tab UI

**Files:**
- Create: `src/components/live/VoiceTab.tsx`
- Modify: `src/components/search/RightPanel.tsx`, `src/styles.css`
- Test: `src/components/live/VoiceTab.test.tsx`, `src/components/search/RightPanel.test.tsx` (create if absent)

**Interfaces:**
- Consumes: Task 7 `useLiveStore` (`status`, `error`, `captions`, `seconds`, `remainingSeconds`, `muted`, `acknowledged`, `searching`, `keywordMode`, `start`, `end`, `setMuted`, `acknowledge`), `useDocumentStore` (`pages.length`).
- Produces: `VoiceTab` default export; `RightPanel` tab union `"ai" | "search" | "voice"`.

- [ ] **Step 1: Write the failing component tests**

```tsx
// src/components/live/VoiceTab.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import VoiceTab from "./VoiceTab";
import { useLiveStore } from "../../store/live";
import { useDocumentStore } from "../../store/document";

const start = vi.fn(async () => {}); const end = vi.fn(async () => {}); const setMuted = vi.fn(); const acknowledge = vi.fn();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  start.mockClear(); end.mockClear(); setMuted.mockClear(); acknowledge.mockClear();
  useLiveStore.setState({ status: "idle", error: null, captions: [], seconds: 0, remainingSeconds: null, resetAt: null, muted: false, acknowledged: false, searching: false, keywordMode: false, conversationId: null, start, end, setMuted, acknowledge });
  useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map([["s", { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" }]]), pages: [{ id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] });
});

describe("VoiceTab", () => {
  it("is disabled without a document", () => {
    useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map(), pages: [] });
    render(<VoiceTab />);
    expect(screen.getByTestId("voice-start")).toBeDisabled();
    expect(screen.getByText("Open a document first.")).toBeTruthy();
  });
  it("asks for the disclosure once, then starts", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VoiceTab />);
    fireEvent.click(screen.getByTestId("voice-start"));
    expect(confirm).toHaveBeenCalledWith("Voice sends your microphone audio to ElevenLabs and the passages of this document needed to answer each question to ElevenLabs and Anthropic. Recordings are not kept. About $0.10 per minute, 30 minutes per day.");
    expect(acknowledge).toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    useLiveStore.setState({ acknowledged: true });
    fireEvent.click(screen.getByTestId("voice-start"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("does not start when the disclosure is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<VoiceTab />);
    fireEvent.click(screen.getByTestId("voice-start"));
    expect(start).not.toHaveBeenCalled();
  });
  it("renders the live state: captions, elapsed, remaining, searching, keyword note, mute and end", () => {
    useLiveStore.setState({ status: "live", seconds: 65, remainingSeconds: 1500, captions: [{ role: "you", text: "what dose" }, { role: "assistant", text: "Five milligrams" }], searching: true, keywordMode: true });
    render(<VoiceTab />);
    expect(screen.getByTestId("voice-captions").textContent).toContain("what dose");
    expect(screen.getByTestId("voice-captions").textContent).toContain("Five milligrams");
    expect(screen.getByTestId("voice-status").textContent).toContain("1:05");
    expect(screen.getByTestId("voice-status").textContent).toContain("25 min left today");
    expect(screen.getByText("Searching the document…")).toBeTruthy();
    expect(screen.getByText("Using keyword matching (search model not loaded)")).toBeTruthy();
    fireEvent.click(screen.getByTestId("voice-mute"));
    expect(setMuted).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("voice-end"));
    expect(end).toHaveBeenCalled();
  });
  it("shows Unmute when muted and the error with Retry", () => {
    useLiveStore.setState({ status: "live", muted: true });
    const { unmount } = render(<VoiceTab />);
    expect(screen.getByTestId("voice-mute").textContent).toBe("Unmute");
    unmount();
    useLiveStore.setState({ status: "error", error: "Voice service unavailable right now.", acknowledged: true });
    render(<VoiceTab />);
    expect(screen.getByTestId("voice-error").textContent).toBe("Voice service unavailable right now.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(start).toHaveBeenCalled();
  });
});
```

```tsx
// src/components/search/RightPanel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RightPanel from "./RightPanel";
import { useSearchStore } from "../../store/search";

afterEach(cleanup);

describe("RightPanel", () => {
  it("has a Voice tab that shows the voice panel", () => {
    useSearchStore.setState({ init: async () => {} } as never);
    render(<RightPanel />);
    fireEvent.click(screen.getByTestId("panel-tab-voice"));
    expect(screen.getByTestId("voice-start")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/live src/components/search/RightPanel.test.tsx`
Expected: FAIL (VoiceTab missing; no voice tab).

- [ ] **Step 3: Implement the tab and wire it in**

```tsx
// src/components/live/VoiceTab.tsx
import { useLiveStore } from "../../store/live";
import { useDocumentStore } from "../../store/document";

export const DISCLOSURE = "Voice sends your microphone audio to ElevenLabs and the passages of this document needed to answer each question to ElevenLabs and Anthropic. Recordings are not kept. About $0.10 per minute, 30 minutes per day.";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function VoiceTab() {
  const s = useLiveStore();
  const hasDoc = useDocumentStore((d) => d.pages.length > 0);

  const begin = () => {
    if (!s.acknowledged) {
      if (!window.confirm(DISCLOSURE)) return;
      s.acknowledge();
    }
    void s.start();
  };

  if (s.status === "live" || s.status === "ending" || s.status === "connecting") {
    return (
      <div className="ai-tab voice-tab">
        <div className="ai-row">
          <span className={`voice-dot ${s.status === "live" ? "on" : ""}`} aria-hidden="true" />
          <span data-testid="voice-status">
            {s.status === "connecting" ? "Connecting…" : s.status === "ending" ? "Ending…" : mmss(s.seconds)}
            {s.remainingSeconds !== null && ` · ${Math.floor(s.remainingSeconds / 60)} min left today`}
          </span>
        </div>
        {s.keywordMode && <p className="muted">Using keyword matching (search model not loaded)</p>}
        <div className="voice-captions" data-testid="voice-captions">
          {s.captions.map((c, i) => <p key={i} className={`caption ${c.role}`}><b>{c.role === "you" ? "You" : "Assistant"}:</b> {c.text}</p>)}
          {s.searching && <p className="muted">Searching the document…</p>}
        </div>
        <div className="ai-row">
          <button data-testid="voice-mute" onClick={() => s.setMuted(!s.muted)} disabled={s.status !== "live"}>{s.muted ? "Unmute" : "Mute"}</button>
          <button data-testid="voice-end" className="primary" onClick={() => void s.end()} disabled={s.status === "ending"}>End</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-tab voice-tab">
      <p className="muted">Talk with an assistant about the open document. It answers only from the document's text and cites pages.</p>
      {s.error && <p className="ai-error" data-testid="voice-error">{s.error}</p>}
      {s.captions.length > 0 && (
        <div className="voice-captions" data-testid="voice-captions">
          {s.captions.map((c, i) => <p key={i} className={`caption ${c.role}`}><b>{c.role === "you" ? "You" : "Assistant"}:</b> {c.text}</p>)}
        </div>
      )}
      <button data-testid="voice-start" className="primary" onClick={begin} disabled={!hasDoc}>{s.status === "error" ? "Retry" : "Start voice session"}</button>
      {!hasDoc && <p className="muted">Open a document first.</p>}
      {s.remainingSeconds !== null && <p className="muted">{Math.floor(s.remainingSeconds / 60)} min left today</p>}
    </div>
  );
}
```

`RightPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useSearchStore } from "../../store/search";
import AiPanel from "../ai/AiPanel";
import SearchTab from "./SearchTab";
import VoiceTab from "../live/VoiceTab";

export default function RightPanel() {
  const [tab, setTab] = useState<"ai" | "search" | "voice">("ai");
  const init = useSearchStore((st) => st.init);
  useEffect(() => { void init(); }, [init]);
  return (
    <div className="ai-panel">
      <div className="ai-tabs panel-tabs">
        <button data-testid="panel-tab-ai" className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>AI</button>
        <button data-testid="panel-tab-search" className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>Search</button>
        <button data-testid="panel-tab-voice" className={tab === "voice" ? "active" : ""} onClick={() => setTab("voice")}>Voice</button>
      </div>
      {tab === "ai" ? <AiPanel /> : tab === "search" ? <SearchTab /> : <VoiceTab />}
    </div>
  );
}
```

Append to `src/styles.css`:

```css
.voice-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); display: inline-block; }
.voice-dot.on { background: var(--danger); animation: voice-pulse 1.2s ease-in-out infinite; }
@keyframes voice-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.voice-captions { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; background: var(--bg); border-radius: 8px; padding: 10px; }
.voice-captions .caption { margin: 0; }
.voice-captions .caption.you { opacity: 0.8; }
```

- [ ] **Step 4: Run the tests, the full suite, and typecheck**

Run: `npx vitest run && npx tsc -b`
Expected: all pass. The "Retry" button in the error test is the start button relabelled; `getByRole("button", { name: "Retry" })` finds it.

- [ ] **Step 5: Commit**

```bash
git add src/components/live/VoiceTab.tsx src/components/live/VoiceTab.test.tsx src/components/search/RightPanel.tsx src/components/search/RightPanel.test.tsx src/styles.css
git commit -m "feat(ui): Voice tab with disclosure, captions, mute and end"
```

---

### Task 9: End-to-end test, smoke script, README

**Files:**
- Create: `e2e/voice.spec.ts`, `worker/scripts/live-smoke.ts`
- Modify: `src/store/live.ts` (dev hook for the e2e stub), `README.md`

**Interfaces:**
- Consumes: Task 7 `configureLiveDeps`; Task 4 `provisionAgent` outputs (agent id in `worker/.dev.vars` for the smoke script).
- Produces: an ungated Playwright test; `npx tsx worker/scripts/live-smoke.ts` prints agent LLM/privacy and the last conversation's duration, LLM usage and cost (gated by `E2E_LIVE=1`, otherwise exits 0 with a note).

- [ ] **Step 1: Add the test hook to the store**

At the end of `src/store/live.ts` (inside the `typeof window !== "undefined"` block), add:

```ts
  // Test hook: an e2e test can install a fake SDK and a fake microphone before the app boots.
  const w = window as unknown as { __pdfstudioLiveStub?: { startSession: StartSession; getMedia?: () => Promise<void> } };
  if (w.__pdfstudioLiveStub) configureLiveDeps({ startSession: w.__pdfstudioLiveStub.startSession, getMedia: w.__pdfstudioLiveStub.getMedia ?? (async () => {}) });
```

- [ ] **Step 2: Write the e2e test**

```ts
// e2e/voice.spec.ts
import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function notePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 300]);
  p.drawText("Medication list. Warfarin 5 mg nightly. INR goal 2 to 3.", { x: 30, y: 250, size: 11, font });
  return Buffer.from(await doc.save());
}

test("voice session: start, tool search, captions, end reports usage", async ({ page }) => {
  await page.route("**/session", (r) => r.fulfill({ json: { token: "t", expiresAt: 9999999999 } }));
  await page.route("**/live", (r) => r.fulfill({ json: { conversationId: "conv_e2e", token: "el", remainingSeconds: 1200, resetAt: 0 } }));
  const usage: unknown[] = [];
  await page.route("**/live/usage", async (r) => { usage.push(r.request().postDataJSON()); await r.fulfill({ json: { remainingSeconds: 1785 } }); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__pdfstudioLiveStub = {
      getMedia: async () => {},
      startSession: async (opts: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        w.__liveOpts = opts;
        setTimeout(() => opts.onConnect?.(), 0);
        return { endSession: async () => { setTimeout(() => opts.onDisconnect?.({ reason: "user" }), 0); }, sendContextualUpdate: () => {}, setMicMuted: () => {}, getId: () => "conv_e2e" };
      },
    };
  });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', { name: "note.pdf", mimeType: "application/pdf", buffer: await notePdf() });
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await page.getByTestId("panel-tab-voice").click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("voice-start").click();
  await expect(page.getByTestId("voice-status")).toContainText("min left today");
  const result = await page.evaluate(() => (window as unknown as { __liveOpts: { clientTools: { search_document(p: { query: string }): Promise<string> } } }).__liveOpts.clientTools.search_document({ query: "warfarin dose" }));
  expect(result).toMatch(/^\[p\. 1\] .*Warfarin 5 mg nightly/);
  await page.evaluate(() => { const o = (window as unknown as { __liveOpts: Record<string, any> }).__liveOpts; o.onMessage({ role: "user", message: "what is the warfarin dose", event_id: 1 }); o.onMessage({ role: "agent", message: "Five milligrams nightly, page 1.", event_id: 2 }); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await expect(page.getByTestId("voice-captions")).toContainText("Five milligrams nightly");
  await expect(page.getByText("Using keyword matching (search model not loaded)")).toBeVisible();
  await page.getByTestId("voice-end").click();
  await expect(page.getByTestId("voice-start")).toBeVisible();
  await expect.poll(() => usage.length).toBe(1);
  expect(usage[0]).toMatchObject({ conversationId: "conv_e2e" });
  await expect(page.getByText("29 min left today")).toBeVisible();
});
```

Run: `npx playwright test e2e/voice.spec.ts --reporter=line`
Expected: 1 passed. (The dev server on port 5199 is started by the Playwright config.)

- [ ] **Step 3: Write the smoke script**

```ts
// worker/scripts/live-smoke.ts
// Real-key smoke: E2E_LIVE=1 npx tsx worker/scripts/live-smoke.ts  (from the repo root)
// Mints a token for the provisioned agent, prints the agent's LLM and privacy settings, and the last
// conversation's duration / LLM usage / cost so the real per-minute cost can be read. Never prints the key.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.E2E_LIVE !== "1") { console.log("E2E_LIVE is not set; skipping the real-key smoke."); process.exit(0); }
const vars = Object.fromEntries(readFileSync(resolve(process.cwd(), "worker/.dev.vars"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const key = vars.ELEVENLABS_API_KEY; const agent = vars.ELEVENLABS_AGENT_ID;
if (!key || !agent) { console.error("ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID missing in worker/.dev.vars"); process.exit(1); }
const base = "https://api.elevenlabs.io";
const get = async (p: string) => { const r = await fetch(base + p, { headers: { "xi-api-key": key } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const tok = await get(`/v1/convai/conversation/token?agent_id=${agent}`);
console.log(`token endpoint: ${tok.status} ${tok.status === 200 ? "(ok; token not printed)" : JSON.stringify(tok.body).slice(0, 300)}`);
const a = await get(`/v1/convai/agents/${agent}`);
console.log("agent:", JSON.stringify({ llm: a.body?.conversation_config?.agent?.prompt?.llm, tools: a.body?.conversation_config?.agent?.prompt?.tool_ids, privacy: a.body?.platform_settings?.privacy, max: a.body?.conversation_config?.conversation?.max_duration_seconds }, null, 2));
const list = await get(`/v1/convai/conversations?agent_id=${agent}&page_size=1`);
const last = list.body?.conversations?.[0];
if (!last) { console.log("no conversations yet"); process.exit(0); }
const c = await get(`/v1/convai/conversations/${last.conversation_id}`);
const llm = (c.body?.transcript ?? []).map((t: { llm_usage?: unknown }) => t.llm_usage).filter(Boolean);
console.log("last conversation:", JSON.stringify({ status: c.body?.status, call_duration_secs: c.body?.metadata?.call_duration_secs, cost: c.body?.metadata?.cost, cost_fiat: c.body?.metadata?.cost_fiat, llm_turns: llm.length, llm_usage: llm }, null, 2));
```

Run: `npx tsx worker/scripts/live-smoke.ts` — Expected: prints the skip note and exits 0 (E2E_LIVE unset).

- [ ] **Step 4: README**

Add a "Voice" paragraph to `README.md` after the existing feature paragraphs (match the surrounding style):

```markdown
**Voice.** The Voice tab starts a spoken conversation about the open document with an ElevenLabs agent whose language model is Claude Sonnet 5.5. The agent cannot see the document; it calls a `search_document` tool that runs in your browser (the same on-device retrieval as Ask, with keyword matching when the search model is not loaded) and answers only from the passages returned, citing pages. Microphone audio goes to ElevenLabs; returned passages go to ElevenLabs and Anthropic. The agent is configured not to record audio and to delete transcripts; nothing is kept by PDF Studio. Sessions last up to 10 minutes and end after 2 minutes of silence; the shared allowance is 30 minutes per visitor per day. Operators provision the agent with `npx tsx worker/scripts/provision-agent.ts` (reads `worker/.dev.vars`) and set `ELEVENLABS_AGENT_ID` in `worker/wrangler.jsonc`.
```

- [ ] **Step 5: Full verification and commit**

Run: `npx vitest run && npx tsc -b && npm --prefix worker test && npm --prefix worker run typecheck && npx playwright test e2e/voice.spec.ts --reporter=line`
Expected: all green.

```bash
git add e2e/voice.spec.ts worker/scripts/live-smoke.ts src/store/live.ts README.md
git commit -m "test(live): e2e voice flow with a stubbed SDK; real-key smoke script; README"
```

---

### Task 10 (operator, run by the coordinator, not a subagent): provision and verify

- [ ] Run `npx tsx worker/scripts/provision-agent.ts` from the repo root; record the printed `agentId`, `toolId`, `zeroRetention`, `privacy` in the ledger (no key is printed).
- [ ] Put the agent id in `worker/wrangler.jsonc` `vars.ELEVENLABS_AGENT_ID` and in `worker/.dev.vars` `ELEVENLABS_AGENT_ID=`; commit `wrangler.jsonc` only.
- [ ] Run `E2E_LIVE=1 npx tsx worker/scripts/live-smoke.ts`; expect `token endpoint: 200` and `llm: "claude-sonnet-5-5"`.
- [ ] If `zeroRetention` came back `false`, add one sentence to the README Voice paragraph: "Zero-retention mode is not available on the current ElevenLabs plan; transcripts are deleted on a zero-day retention schedule instead."
- [ ] Deploy the worker (`cd worker && npx wrangler deploy`) and the app, then try a real session in Chrome against production and read the cost line from the smoke script.
