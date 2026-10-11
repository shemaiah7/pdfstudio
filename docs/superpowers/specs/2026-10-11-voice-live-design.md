# Voice conversation with GPT-Live — design

Date: 2026-10-11. Sub-project 6 of PDF Studio.

## Goal

Let a clinician talk with an assistant about the open document hands-free: ask by voice, hear a short grounded answer, interrupt naturally. Answers come only from the document's text (the same retrieval Ask uses). Nothing is stored server-side; the API key stays in the worker.

## Facts about GPT-Live (verified 2026-10-11)

- Model `gpt-live-1`, endpoint `POST /v1/live/sessions`; voice billed at $0.05 per minute, per second; a WebRTC session bills 15 s at initialization, credited against duration.
- The browser creates a WebRTC offer; the application server posts it to OpenAI with the session config and returns the answer SDP and `session.id`. Audio travels on media tracks; a data channel named `oai-events` carries JSON events.
- Events: `session.started`, `session.updated`, `session.usage.updated` (`usage.seconds`), `session.input_transcript.delta`, `session.output_transcript.delta`, `session.delegation.created`, `error`, `session.closed` (`usage.seconds`, `reason` ∈ `close_requested | expired | content | remote_hangup | connection_lost`). Client sends `session.close` and waits for `session.closed`.
- Context injection: `session.thinking.append` (facts the model may use silently), `session.commentary.append` (things to say aloud), `session.instructions.append` (behaviour). Each takes `content` ≤ 500 tokens and `delegation_id` (null for session-wide). Acknowledged by `*.appended` with `client_event_id`.
- Delegation `{ type: "client" }`: the application does its own work and appends results. `store` defaults to false; with it false nothing is retained.
- Do not send `session.start` or `session.input_audio.append` over the data channel for WebRTC.

## Decisions

| Question | Decision |
| --- | --- |
| Purpose | Hands-free Q&A while working: low latency, barge-in. |
| Provider | OpenAI GPT-Live (`gpt-live-1`), client delegation. |
| Grounding | Retrieve passages per utterance on the device (Search module's `retrievePassages`; keyword fallback without the search model) and push them with `session.thinking.append`. The whole document is never sent. |
| Activation | Tap to start a session; mic stays open (full duplex) until End, 10 minutes, or 2 minutes of silence. |
| Allowance | 30 voice minutes per visitor-day enforced by the worker; 10-minute session cap. |
| Privacy | First use per app session shows a disclosure; `store: false`; the worker never logs audio or SDP bodies. |
| Rejected | Responses delegation with a server-hosted search tool (whole chart server-side, second model billed); Realtime API (not GPT-Live). |

## Worker

### `POST /live`
- Auth: the existing session bearer token (Turnstile). Body `{ sdp: string }` (≤ 64 KB).
- Quota (KV, `v:${vid}:${day}` → `{ seconds: number, sessions: number }`): refuse with 429 `voice_limit` (+ `resetAt`) when `seconds + 600 > 1800`; otherwise charge 600 s at admission (`sessions + 1`), expiring with the day.
- Calls `https://api.openai.com/v1/live/sessions` with `Authorization: Bearer ${env.OPENAI_API_KEY}`, body:
  ```json
  { "session": { "model": "gpt-live-1", "instructions": "<INSTRUCTIONS>", "delegation": { "type": "client" }, "store": false },
    "transport": { "type": "webrtc", "sdp": "<offer>" } }
  ```
  Returns `{ sessionId, sdp }` from `session.id` and `transport.sdp` (HTTP 201 expected). Non-2xx → 502 `voice_unavailable` (status logged, body not logged). Timeout 15 s.
- `OPENAI_API_KEY` is a new wrangler secret; `wrangler.jsonc` unchanged otherwise.

### `POST /live/usage`
- Body `{ sessionId: string, seconds: number }` (0–600). Replaces the 600 s admission charge for that visitor-day with `max(seconds, 15)` for that session: the KV record keeps `charged` per session id (`{ [sessionId]: seconds }`), and `seconds` total = Σ charged. Idempotent: a repeat report overwrites. Returns `{ remainingSeconds }`.

### Instructions (constant `LIVE_INSTRUCTIONS` in `worker/src/prompts/live.ts`)
"You are a voice assistant for a clinician reading a document in PDF Studio. The application will add relevant passages from the document to your context as 'thinking' notes, each prefixed with a page number. Answer only from those passages. If the passages do not contain the answer, say so briefly and offer to look again with different words. Cite the page. Read numbers, units, dates, and names slowly and exactly as written. Do not give diagnoses or treatment advice beyond what the document states. Keep answers to two or three sentences; the user is working hands-free."

## Browser

### `src/live/liveClient.ts`
```ts
export interface LiveEvents { onStarted(): void; onInputTranscript(delta: string): void; onOutputTranscript(delta: string): void; onUsage(seconds: number): void; onDelegation(id: string): void; onError(message: string): void; onClosed(reason: string, seconds: number): void }
export interface LiveTransport { createSession(sdp: string): Promise<{ sessionId: string; sdp: string }> }   // the AI client implements it (POST /live)
export class LiveClient {
  constructor(transport: LiveTransport, events: LiveEvents, deps?: { rtc?: () => RTCPeerConnection; media?: () => Promise<MediaStream> })
  start(): Promise<void>         // getUserMedia → RTCPeerConnection → audio element → data channel "oai-events" (listeners before offer) → createOffer → wait for ICE gathering complete (≤ 3 s) → transport.createSession → setRemoteDescription → resolves on session.started (≤ 15 s)
  appendThinking(content: string, delegationId?: string | null): void
  appendCommentary(content: string, delegationId: string): void
  appendInstructions(content: string): void
  mute(on: boolean): void        // track.enabled
  close(): Promise<string>       // sends session.close, resolves with reason on session.closed (≤ 5 s, else forces teardown with "connection_lost"); stops tracks, closes pc
  readonly sessionId: string | null
}
```
Each append carries an `event_id` (`evt-${n}`); acknowledgments are ignored except for logging.

### `src/live/grounding.ts` (pure)
```ts
export function createUtteranceSegmenter(onUtterance: (text: string) => void, quietMs = 700, now = Date.now, schedule = setTimeout): { push(delta: string): void; flush(): void }
export function chunkPassages(passages: { page: number; text: string }[], maxTokens = 450): string[]   // "[p. N] text" joined, split so each chunk ≤ maxTokens (tokens ≈ words × 1.3)
export function keywordPassages(pages: { page: number; text: string }[], question: string, limit = 3): { page: number; text: string }[]   // reuses queryTerms from the search ranker; scores pages by term hits; returns a 600-character window around the first hit
export function overview(name: string, pageCount: number, firstPageText: string): string   // "Document: name, N pages. Begins: <first 300 chars>"
```

### `src/store/live.ts`
`useLiveStore`: `status: "idle" | "connecting" | "live" | "ending" | "error"`, `error`, `captions: { role: "you" | "assistant"; text: string }[]` (deltas appended to the last caption of the same role; a new caption starts after 1.5 s of silence from that role), `seconds`, `remainingSeconds` (from the usage reply, else 1800 − today's reported), `muted`, `acknowledged` (disclosure), `start()`, `end()`, `setMuted()`, `acknowledge()`. `start()` builds the client with the AI client's transport, wires grounding: on `onStarted` append the overview; on each utterance run `retrievePassages(utterance, 4)` when the search model is ready (and not "indexing"), else `keywordPassages(documentText("all"), utterance)`; append chunks (max 3 per utterance); when nothing matches append "No passage in the document matched: <utterance>". Session cap timer 600 s and silence timer 120 s (reset on any transcript delta) call `end()`. On `onClosed` POST `/live/usage` with `seconds` and update `remainingSeconds`. Document change (sources map identity) while live → `end()`.

### `src/ai/client.ts`
`createLiveSession(sdp)` → `POST /live` with the bearer token (401 retry like `runOcr`), errors thrown with the worker code (`voice_limit` with `resetAt`, `voice_unavailable`, `verification_failed`, `network`); `reportLiveUsage(sessionId, seconds)`.

### UI `src/components/live/VoiceTab.tsx`
Third tab "Voice" in `RightPanel` (`data-testid="panel-tab-voice"`). Idle: explanation line, "Start voice session" (`data-testid="voice-start"`, disabled with "Open a document first." when no document). First start per app session: `window.confirm` with the disclosure "Voice sends your microphone audio and the passages of this document needed to answer to OpenAI (GPT-Live). Audio is not stored by OpenAI. About $0.05 per minute, 30 minutes per day." Live: pulsing dot, captions list (`data-testid="voice-captions"`), elapsed `m:ss`, "N min left today", Mute/Unmute (`voice-mute`), End (`voice-end`). Error: message with Retry. Status line notes "Using keyword matching (search model not loaded)" when applicable.

## Error handling

| Case | Behaviour |
| --- | --- |
| Mic permission denied / no device | `Microphone access is needed for voice.` with Retry; nothing sent. |
| 429 `voice_limit` | `Voice allowance used for today; resets at HH:MM.` |
| 401/403 | Turnstile re-verify path as Ask. |
| 502 `voice_unavailable` | `Voice service unavailable right now.` |
| Connection fails / `session.closed` with `connection_lost` or `remote_hangup` | Panel idle with `Connection lost`; usage reported with the last known seconds. |
| Retrieval error or indexing | Keyword fallback; no match → "No passage matched" note appended. |
| Append `error` event | Logged, session continues. |
| 10-minute cap / 2-minute silence | `session.close`; `Session ended` shown. |
| Document closed mid-session | Session ended; captions kept until the tab is left. |
| Page unload while live | `session.close` attempted via `pagehide`; usage report sent with `keepalive`. |

## Testing

- Worker: `/live` body validation, quota admission (600 s charge; refuse past 1800 s), OpenAI request shape with mocked fetch (model, client delegation, `store: false`, webrtc transport), error mapping; `/live/usage` reconciliation and idempotence.
- Browser units: utterance segmentation (quiet gap, flush), `chunkPassages` limits and page prefixes, `keywordPassages` ranking and window, `overview`, `LiveClient` with a fake peer connection and data channel (started → transcripts → usage → close handshake → closed; timeout teardown), store transitions and timers (fake timers), grounding wiring with a mocked retriever.
- Component: Voice tab states, disclosure once, disabled without a document, captions render, Mute/End.
- E2E: ungated test with `/session`, `/live`, `/live/usage` mocked and `getUserMedia`/`RTCPeerConnection` stubbed in `addInitScript`, asserting the SDP offer is posted and the tab reaches live and ends; gated `E2E_LIVE=1` real-key smoke test (skipped by default).

## Non-goals

- Voice-driven form filling or editing; reading whole documents aloud; multiple languages beyond what GPT-Live handles natively; session recording or forking; image input.
