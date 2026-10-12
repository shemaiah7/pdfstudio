# Voice conversation about the open document — design

Date: 2026-10-11 (revised 2026-10-11 23:50 for ElevenLabs). Sub-project 6 of PDF Studio.

## Goal

Let a clinician talk with an assistant about the open document hands-free: ask by voice, hear a short grounded answer, interrupt naturally. Answers come only from the document's text, retrieved on the device by the same code Ask uses. The document is never uploaded; only the passages needed for each answer leave the browser. API keys stay in the worker.

## Provider decision

| Option | Verdict |
| --- | --- |
| ElevenLabs Agents with Claude Sonnet 5.5 as the LLM | **Chosen.** The brain is the model we already trust for Ask; a blocking client tool lets the LLM pull passages from the open PDF when it needs them; voices and turn-taking are ElevenLabs' strength. About $0.08 per minute plus Claude tokens at provider rates. |
| OpenAI GPT-Live (`gpt-live-1`) | Rejected for now. Best conversational feel and $0.05/min all-in, but the live model is the brain, grounding is push-only, and no choice of LLM. Earlier revision of this spec; the `OPENAI_API_KEY` worker secret stays set and unused. |
| ElevenLabs with Custom LLM pointing at our worker | Rejected: adds an OpenAI-compatible proxy to maintain for no benefit over the hosted Claude option. |

## Facts about ElevenLabs Agents (verified 2026-10-11 against the API reference and `@elevenlabs/client` 1.27.0)

- Agent: `POST /v1/convai/agents/create` and `PATCH /v1/convai/agents/{agent_id}` with `conversation_config` (`agent.prompt.{prompt,llm,temperature,tool_ids}`, `agent.first_message`, `tts.{voice_id,model_id}`, `turn.{turn_timeout,turn_eagerness}`, `conversation.{max_duration_seconds,client_events}`) and `platform_settings` (`auth.{enable_auth,allowlist}`, `privacy.{record_voice,retention_days,delete_transcript_and_pii,delete_audio,zero_retention_mode}`). `llm: "claude-sonnet-5-5"` is an accepted value. Default retention is 2 years unless set.
- Client tool: `POST /v1/convai/tools` with `tool_config: { type: "client", name, description, expects_response, response_timeout_secs, parameters }` → `{ id }`; referenced from the agent via `prompt.tool_ids`.
- Session token for a private agent: `GET /v1/convai/conversation/token?agent_id=…` with header `xi-api-key` → `{ token, conversation_id }`. The browser passes `conversationToken` to the SDK and connects over WebRTC.
- Conversation record: `GET /v1/convai/conversations/{conversation_id}` → `status` (`initiated | in-progress | processing | done | failed`), `metadata.call_duration_secs`, `metadata.cost`, `transcript[]`.
- Browser SDK `@elevenlabs/client`: `Conversation.startSession({ conversationToken, connectionType: "webrtc", clientTools: { name: (params) => string | Promise<string> }, onConnect, onDisconnect(details), onError(message), onMessage({ role: "user" | "agent", message }), onModeChange({ mode: "speaking" | "listening" }), onStatusChange({ status }), onInterruption })` returns a `VoiceConversation` with `endSession()`, `getId()`, `sendContextualUpdate(text)`, `sendUserMessage(text)`, `setMicMuted(bool)`, `setVolume({ volume })`. `startSession` throws when the microphone is denied or the connection fails.
- The API key issued for this project has only the ElevenAgents (Write) scope; it is the worker secret `ELEVENLABS_API_KEY` and the local `worker/.dev.vars` entry. The agent id is not secret and goes in `wrangler.jsonc` `vars.ELEVENLABS_AGENT_ID`.

## Decisions

| Question | Decision |
| --- | --- |
| Purpose | Hands-free Q&A while working: low latency, barge-in. |
| Brain | `claude-sonnet-5-5` hosted by ElevenLabs, temperature 0. |
| Voice | Default ElevenLabs voice (`cjVigY5qzO86Huf0OWal`) on `eleven_v4_turbo`. Changing voice later is a one-field agent update. |
| Grounding | Pull: a blocking client tool `search_document` runs on the device (Search module's `retrievePassages`, keyword fallback without the search model) and returns the matching passages. Plus one `sendContextualUpdate` at session start with the document overview. The whole document is never sent. |
| Activation | Tap to start; mic stays open until End, 10 minutes (`max_duration_seconds: 600` enforced server-side, mirrored client-side), or 2 minutes of silence (client timer). |
| Allowance | 30 voice minutes per visitor-day enforced by the worker; 600 s charged at admission and reconciled from ElevenLabs' own `call_duration_secs`, so the client cannot under-report. |
| Privacy | Agent privacy settings: `record_voice: false`, `retention_days: 0`, `delete_transcript_and_pii: true`, `delete_audio: true`, and `zero_retention_mode: true` attempted (kept if the API accepts it on this plan, otherwise dropped and noted in the README). First use per app session shows a disclosure. The worker never logs transcripts. |
| Agent provisioning | A script in the repo (`worker/scripts/provision-agent.ts`) creates or updates the agent and the tool idempotently from code, so prompt, LLM, privacy and tool settings are versioned. It is run by hand with the key from `worker/.dev.vars`; it is not part of deploy. `platform_settings.auth.enable_auth: true` with allowlist `pdfstudio.shemaiah7.workers.dev` and `localhost`. |
| Rejected | Knowledge-base upload of the PDF (document would live on ElevenLabs); push-only grounding by utterance segmentation (the LLM now decides when to search); phone/telephony. |

## Worker

### `POST /live`
- Auth: the existing session bearer token (Turnstile). Empty body.
- Quota (KV, `v:${vid}:${day}` → `{ seconds: number, charged: { [conversationId]: number } }`): refuse with 429 `voice_limit` (+ `resetAt`) when `seconds + 600 > 1800`; otherwise call `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${env.ELEVENLABS_AGENT_ID}` with `xi-api-key: ${env.ELEVENLABS_API_KEY}` (timeout 10 s), then record `charged[conversation_id] = 600` and `seconds += 600`, expiring with the day. Returns `{ conversationId, token, remainingSeconds }`. Non-2xx from ElevenLabs → 502 `voice_unavailable` (status logged, body not logged).

### `POST /live/usage`
- Body `{ conversationId: string, seconds: number }` (`seconds` 0–600 is the client's fallback). The worker looks the id up in the visitor's `charged` map (unknown id → 404 `unknown_conversation`), then calls `GET /v1/convai/conversations/{conversationId}`; if the reply has `metadata.call_duration_secs` it uses that, otherwise the client's `seconds`. Sets `charged[id] = max(actual, 15)` and `seconds = Σ charged`. Idempotent. Returns `{ remainingSeconds }`. ElevenLabs may still report `processing` for a few seconds after hang-up; the duration field is present in that state, so no retry loop.

### Provisioning script `worker/scripts/provision-agent.ts`
Run with `npx tsx worker/scripts/provision-agent.ts` from the repo root; reads `ELEVENLABS_API_KEY` and optional `ELEVENLABS_AGENT_ID` from `worker/.dev.vars`. Steps: create or patch the `search_document` tool (looked up by name via `GET /v1/convai/tools`); create or patch the agent named `PDF Studio Voice`; print the agent id and the privacy settings the API accepted, then re-read the agent to confirm them. Then the operator writes the id into `wrangler.jsonc` `vars.ELEVENLABS_AGENT_ID` and `worker/.dev.vars`.

Agent config (constants in `worker/src/prompts/live.ts`, shared with the script):
- `agent.prompt.prompt` = `LIVE_INSTRUCTIONS`: "You are a voice assistant for a clinician reading a document in PDF Studio. You cannot see the document. Before answering any question about its contents, call search_document with the key words of the question; you may call it more than once with different words. Answer only from the passages it returns and cite the page. If nothing relevant comes back, say so briefly and offer to look again with different words. Read numbers, units, dates, and names slowly and exactly as written. Do not give diagnoses or treatment advice beyond what the document states. Keep answers to two or three sentences; the user is working hands-free."
- `agent.prompt.llm: "claude-sonnet-5-5"`, `temperature: 0`, `tool_ids: [searchToolId]`.
- `agent.first_message: "Ready. Ask me about the open document."`, `language: "en"`.
- `turn: { turn_timeout: 7, turn_eagerness: "normal" }`.
- `conversation: { max_duration_seconds: 600, client_events: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "client_tool_call"] }`.
- Tool: `{ type: "client", name: "search_document", description: "Search the document the user has open and return the most relevant passages with page numbers. Call this before answering any question about the document's contents.", expects_response: true, response_timeout_secs: 10, parameters: { type: "object", properties: { query: { type: "string", description: "Key words or a short question to search for" } }, required: ["query"] } }`.
- `platform_settings.auth: { enable_auth: true, allowlist: [{ hostname: "pdfstudio.shemaiah7.workers.dev" }, { hostname: "localhost" }] }`; `platform_settings.privacy` as in Decisions.

## Browser

### `src/live/liveClient.ts`
Thin wrapper over `@elevenlabs/client` so the store and tests never touch the SDK directly.
```ts
export interface LiveEvents { onConnected(): void; onUserText(text: string): void; onAgentText(text: string): void; onInterruption(): void; onError(message: string): void; onDisconnected(reason: "user" | "agent" | "error", message?: string): void }
export interface LiveTransport { createSession(): Promise<{ conversationId: string; token: string; remainingSeconds: number }> }   // the AI client implements it (POST /live)
export type SearchTool = (query: string) => Promise<string>
export class LiveClient {
  constructor(transport: LiveTransport, events: LiveEvents, search: SearchTool, deps?: { startSession?: typeof Conversation.startSession })
  start(): Promise<void>         // transport.createSession → Conversation.startSession({ conversationToken, connectionType: "webrtc", clientTools: { search_document: ({ query }) => search(query) }, callbacks }) → resolves on onConnect (≤ 15 s)
  sendContext(text: string): void   // sendContextualUpdate
  mute(on: boolean): void           // setMicMuted
  close(): Promise<void>            // endSession; resolves when onDisconnect fires or after 5 s
  readonly conversationId: string | null
}
```
`onMessage` routes by `role`: `"user"` → `onUserText`, `"agent"` → `onAgentText`. `onAgentResponseCorrection` replaces the last agent caption with the corrected text.

### `src/live/grounding.ts` (pure)
```ts
export function formatPassages(passages: { page: number; text: string }[], maxChars = 1500): string   // "[p. N] text" blocks joined by blank lines, truncated to maxChars at a passage boundary; "" when empty
export function keywordPassages(pages: { page: number; text: string }[], query: string, limit = 3): { page: number; text: string }[]   // reuses queryTerms from the search ranker; scores pages by term hits; returns a 600-character window around the first hit
export function overview(name: string, pageCount: number, firstPageText: string): string   // "Document: name, N pages. Begins: <first 300 chars>"
export const NO_MATCH = "No passage in the document matched that query."
```

### `src/store/live.ts`
`useLiveStore`: `status: "idle" | "connecting" | "live" | "ending" | "error"`, `error`, `captions: { role: "you" | "assistant"; text: string }[]`, `seconds` (elapsed, 1 s ticker), `remainingSeconds` (from `/live`, updated by `/live/usage`), `muted`, `acknowledged` (disclosure), `searching: boolean` (a tool call is running), `start()`, `end()`, `setMuted()`, `acknowledge()`. `start()` builds the client with the AI client's transport and a search function: `retrievePassages(query, 4)` when the search model is ready and not indexing, else `keywordPassages(documentText("all"), query)`; result formatted with `formatPassages`, or `NO_MATCH`. On `onConnected` send `overview(...)` as context. Session cap timer 600 s and silence timer 120 s (reset on any caption or interruption) call `end()`. On `onDisconnected` POST `/live/usage` with `{ conversationId, seconds }` and update `remainingSeconds`; reason `"error"` sets `status: "error"` with the message. Document change (sources map identity) while live → `end()`. `pagehide` while live → `end()` and the usage report sent with `keepalive`.

### `src/ai/client.ts`
`createLiveSession()` → `POST /live` (401 retry like `runOcr`); errors thrown with the worker code (`voice_limit` with `resetAt`, `voice_unavailable`, `verification_failed`, `network`); `reportLiveUsage(conversationId, seconds, keepalive?)`.

### UI `src/components/live/VoiceTab.tsx`
Third tab "Voice" in `RightPanel` (`data-testid="panel-tab-voice"`). Idle: explanation line, "Start voice session" (`data-testid="voice-start"`, disabled with "Open a document first." when no document). First start per app session: `window.confirm` with the disclosure "Voice sends your microphone audio to ElevenLabs and the passages of this document needed to answer each question to ElevenLabs and Anthropic. Recordings are not kept. About $0.10 per minute, 30 minutes per day." Live: pulsing dot, captions list (`data-testid="voice-captions"`), "Searching the document…" line while `searching`, elapsed `m:ss`, "N min left today", Mute/Unmute (`voice-mute`), End (`voice-end`). Error: message with Retry. Status line notes "Using keyword matching (search model not loaded)" when applicable.

## Error handling

| Case | Behaviour |
| --- | --- |
| Mic permission denied / no device (`startSession` throws) | `Microphone access is needed for voice.` with Retry; usage reported as 0 s so the admission charge is released. |
| 429 `voice_limit` | `Voice allowance used for today; resets at HH:MM.` |
| 401/403 | Turnstile re-verify path as Ask. |
| 502 `voice_unavailable` | `Voice service unavailable right now.` |
| Connection drops (`onDisconnect` reason `error`) | Panel idle with `Connection lost`; usage reported with the last known seconds. |
| Agent ends the call (reason `agent`, e.g. server-side 600 s cap) | `Session ended`; usage reported. |
| Tool call throws or exceeds 10 s | The client tool returns `NO_MATCH`; the SDK reports an error only if our function throws, so it never throws. |
| Retrieval during indexing | Keyword fallback. |
| 10-minute cap / 2-minute silence | `end()`; `Session ended` shown. |
| Document closed mid-session | Session ended; captions kept until the tab is left. |
| Page unload while live | `endSession` attempted via `pagehide`; usage report sent with `keepalive`. |

## Testing

- Worker: `/live` quota admission (600 s charge; refuse past 1800 s), token request shape with mocked fetch (header, agent id, response mapping), error mapping; `/live/usage` reconciliation from a mocked conversation record, fallback to client seconds, unknown id, idempotence.
- Provisioning script: unit test of the config builder (agent body and tool body match this spec) and of the create-or-patch decision with a mocked fetch.
- Browser units: `formatPassages` limits and page prefixes, `keywordPassages` ranking and window, `overview`; `LiveClient` with a stubbed `startSession` (connect → messages route by role → correction → tool call invokes search → close resolves on disconnect; 5 s teardown timeout); store transitions and timers (fake timers), search wiring with a mocked retriever and the indexing fallback, usage report on every exit path.
- Component: Voice tab states, disclosure once, disabled without a document, captions render, searching line, Mute/End.
- E2E: ungated test with `/session`, `/live`, `/live/usage` mocked and `Conversation.startSession` stubbed through a `window.__pdfstudioLiveStub` hook set in `addInitScript`, asserting the tab reaches live, a simulated tool call returns passages containing a known word, and End reports usage; gated `E2E_LIVE=1` real-key smoke test (skipped by default).

## Non-goals

- Voice-driven form filling or editing; reading whole documents aloud; languages beyond what the agent handles natively; telephony; session recording; image input; voice selection UI.
