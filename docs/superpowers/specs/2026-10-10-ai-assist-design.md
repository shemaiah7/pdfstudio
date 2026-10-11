# PDF Studio: AI Assist (Sub-project 2)

Date: 2026-10-10
Status: Draft for review
Depends on: sub-project 1 (viewer shell and page tools), merged to `main`.

## Goal

Give PDF Studio its differentiating feature: a right-hand AI panel that can
summarize a PDF, answer questions about it, rewrite or explain selected text,
insert the rewritten text back into the PDF, and extract key facts into a
table. Anyone can use it without an account; the product owner pays for the
Claude API calls through a Cloudflare Worker proxy with per-visitor daily
limits and a bot check.

## Decisions already made

- Billing: product owner pays. Proxy enforces limits; no accounts.
- Hosting: Cloudflare. Worker for the proxy, Pages (or Workers static
  assets) for the app in a follow-up.
- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`) via the official
  `@anthropic-ai/sdk` for TypeScript. Streaming on every call.
- Daily limit per visitor: 20 requests and 200,000 tokens (input + output),
  UTC day. Burst limit 5 requests per minute.
- Proxy shape: task endpoint. Prompts live in the Worker. No generic
  passthrough.
- Privacy: PDF bytes never leave the browser. Extracted text for the pages in
  scope is sent to the Worker and on to Anthropic. The panel says so.
- Overlay text editing is pulled forward in minimal form so "Insert into PDF"
  works. The full click-any-line editor remains sub-project 4.

## Users and success criteria

- A visitor opens a PDF, clicks Summarize, and sees a streamed summary within
  a few seconds for a typical document.
- They ask "what is the total due?" and get an answer that cites a page; the
  citation scrolls the viewer to that page.
- They select a paragraph, choose Simplify, read the result, click Insert
  into PDF, and the page shows the new text in place. Download produces a
  PDF where the new text is present and the old text is covered.
- They click Extract and get a table of names, dates, amounts with page
  numbers, copyable as CSV.
- After 20 requests in a day they see a clear message with the reset time.
- Scanned PDFs (no text layer) get a clear "no selectable text" message.

## Architecture

```
browser (React)                      Cloudflare Worker (pdfstudio-ai)
┌────────────────────────┐           ┌───────────────────────────────┐
│ pdf/text.ts  (extract) │           │ POST /session  (Turnstile →   │
│ ai/client.ts (SSE)     │──HTTPS──▶ │   signed session token)       │
│ store/ai.ts            │           │ POST /ai       (task → Claude │
│ components/ai/*        │◀──SSE──── │   stream, quota in KV)        │
│ store/document.ts edits│           │ prompts/*.ts, quota.ts,       │
│ pdf/pageOps.ts  edits  │           │ session.ts, validate.ts       │
└────────────────────────┘           └───────────────┬───────────────┘
                                                     │ @anthropic-ai/sdk
                                                     ▼
                                              Anthropic Messages API
```

### Worker (`worker/`, TypeScript, Wrangler)

**Bindings and secrets** (`worker/wrangler.jsonc`):
- `QUOTA`: KV namespace.
- `BURST`: rate-limit binding, `simple: { limit: 5, period: 60 }`.
- Secrets: `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET`, `SESSION_SECRET`.
- Vars: `ALLOWED_ORIGIN` (the app origin), `TURNSTILE_HOSTNAMES`.

**`POST /session`**
- Body: `{ turnstileToken: string }`.
- Verifies with `https://challenges.cloudflare.com/turnstile/v0/siteverify`
  using the secret, the token, and `CF-Connecting-IP`. Checks `success` and
  that `hostname` is in `TURNSTILE_HOSTNAMES`.
- On success returns `{ token, expiresAt }`. The token is
  `base64url(payload).base64url(hmacSha256(payload, SESSION_SECRET))` where
  payload is `{ vid, exp }`; `vid` is `sha256(ip + daily salt)` truncated,
  `exp` is now + 24 h. The browser keeps it in memory only.
- Failure: 403 `{ error: "verification_failed" }`.

**`POST /ai`**
- Header `Authorization: Bearer <session token>`; invalid or expired → 401.
- Body (validated with zod):
  ```
  {
    task: "summarize" | "ask" | "rewrite" | "extract",
    document: { page: number, text: string }[],   // pages in scope
    question?: string,                              // ask
    history?: { role: "user"|"assistant", text: string }[],  // ask, last 10 turns
    selection?: string,                             // rewrite
    mode?: "rewrite"|"simplify"|"formal"|"translate"|"explain",  // rewrite
    language?: string                               // translate
  }
  ```
  Limits: total document characters ≤ 600,000 (≈150k tokens); selection
  ≤ 20,000 chars; question ≤ 2,000 chars. Over limit → 413
  `{ error: "document_too_large", maxChars }`.
- Quota: key `q:<vid>:<YYYY-MM-DD>` in KV holds `{ requests, tokens }`.
  If `requests ≥ 20` or `tokens ≥ 200000` → 429
  `{ error: "daily_limit", resetAt }` (next UTC midnight). The burst binding
  is checked first → 429 `{ error: "too_fast" }`.
- Builds the request:
  - `system`: task prompt from `worker/src/prompts/<task>.ts`, static text,
    with `cache_control: { type: "ephemeral" }`.
  - `messages[0]` user content: one text block containing the document as
    `<document>` with `<page n="N">…</page>` elements, with
    `cache_control: { type: "ephemeral" }`; then the task input block
    (question / selection / "summarize" instruction).
  - For `ask`, prior turns are inserted between the document block and the
    new question as alternating user/assistant text.
  - `model: "claude-sonnet-5-5"`, `max_tokens: 8000`, no explicit
    `thinking` (adaptive by default), `output_config.effort`: `low` for
    summarize/ask/rewrite, `medium` for extract.
  - `extract` adds `output_config.format` with a JSON schema
    `{ facts: [{ label, value, page }] }` so the result always parses.
  - Refusal fallback: `betas: ["server-side-fallback-2026-07-01"]`,
    `fallbacks: "default"` on `client.beta.messages.stream`.
- Streams: the Worker consumes the SDK stream and re-emits a simplified SSE
  protocol to the browser:
  - `event: delta` `data: {"text": "..."}`
  - `event: done` `data: {"usage": {"input": n, "output": n}, "stop": "end_turn"|"refusal"|"max_tokens"}`
  - `event: error` `data: {"error": "busy"|"upstream"|"refused"}`
  After `done`, the Worker adds `input + output` tokens and one request to
  the KV counter inside `ctx.waitUntil`.
- Error mapping: SDK `RateLimitError` or `InternalServerError` (overloaded)
  → `error: busy` (HTTP 503 if before streaming started); other `APIError`
  → `upstream` (502). Anthropic error bodies are never forwarded.
- CORS: only `ALLOWED_ORIGIN`; preflight handled.

**Prompts** (`worker/src/prompts/`): one file per task exporting a string.
Each instructs Claude to answer only from the document, cite pages as
`(p. N)` for summarize and ask, return only the rewritten text (no preamble)
for rewrite, and fill the schema for extract. Prompts are frozen text so the
cache prefix is stable.

### Browser

**`src/pdf/text.ts`**
- `extractPageText(source, pageIndex): Promise<PageText>` using pdf.js
  `getTextContent`. Returns `{ text, items }` where `items` are
  `{ str, x, y, width, height, fontName, fontSize }` in PDF points (derived
  from the item transform and the page viewport at scale 1). Lines are
  joined by y-position; `text` is the joined string. Cached per
  `(sourceId, pageIndex)`.
- `documentText(scope: "all" | "selected"): { page, text }[]` reads the store's
  page list (in current order, 1-based display page numbers) and returns the
  pages in scope. Rotation does not affect text.
- `hasAnyText(pages)` for the scan check.

**`src/ai/client.ts`**
- `ensureSession()`: runs the invisible Turnstile widget (test keys in dev),
  posts to `/session`, stores the token in the AI store. Re-run once on 401.
- `runTask(body, handlers)`: fetch with the bearer token, parse SSE
  (handles chunks split across `\n\n`), calls `onDelta`, `onDone`,
  `onError`. Returns an abort function.
- Worker URL from `import.meta.env.VITE_AI_URL`.

**`src/store/ai.ts`** (Zustand)
- `session: { token, expiresAt } | null`
- `remaining: { requests, tokens, resetAt } | null` (updated from `done`
  usage locally; the Worker is authoritative)
- Per tab: `summary: { text, status }`, `chat: Turn[]`, `rewrite: { selection,
  mode, language, result, status }`, `extract: { facts, status }`
- `status` is `idle | running | done | error`, with `error` holding the
  user-facing message.
- Chat thread and summary reset when `document.sources` changes.

**Right panel** (`src/components/ai/`)
- `AiPanel`: tabs Summarize / Ask / Rewrite / Extract, privacy notice shown
  once (localStorage flag, wrapped in try/catch), footer with remaining
  requests and the daily reset time, disabled state when over limit.
- `SummarizeTab`: scope toggle (whole document / selected pages), Run,
  streamed markdown (rendered with a small markdown-to-React renderer),
  Copy.
- `AskTab`: thread view, input, Send; page citations `(p. N)` are turned
  into links that scroll `PageView` to page N.
- `RewriteTab`: shows the current selection (or "Select text on a page"),
  mode picker, language field when mode is translate, Run, streamed result,
  Copy, **Insert into PDF**.
- `ExtractTab`: Run, table of label / value / page (page links), Copy as
  CSV.
- Empty document text: every tab shows "This PDF has no selectable text. OCR
  is coming in a later version."

**Text selection in `PageView`**
- Each page gets a pdf.js text layer (`TextLayer` from pdfjs-dist) over the
  canvas so users can select text. A `selectionchange` listener maps the DOM
  selection back to text items: the selected `span`s carry their item index;
  the app collects those items and computes one box per line
  (`{ x, y, width, height }` in PDF points, unrotated page space) plus the
  dominant `fontSize` and `fontName`.
- The selection is stored in the AI store as
  `{ pageEntryId, text, boxes, fontSize, fontName }`.

**Overlay edits**
- Document store gains `edits: Edit[]` where
  `Edit = { id, pageEntryId, boxes: Box[], text, fontSize, font: "sans"|"sans-bold"|"serif", color: [r,g,b] }`.
  Actions: `addEdit(edit)`, `removeEdit(id)`. Edits are part of the undo
  snapshot (the snapshot becomes `{ pages, edits }`), survive reorder and
  rotate, and are dropped by `remove(ids)` for deleted pages.
- `src/pdf/layout.ts`: `layoutText(text, region, fontSize, measure)` returns
  `{ lines: { text, x, y }[], fontSize, overflow: boolean }`. Wraps words to
  the region width using a width-measuring function; if the lines exceed
  the region height, retries at 95 %, 90 %, … down to 70 % of the original
  size; if still overflowing, returns `overflow: true` with the lines that
  fit. Pure and unit-tested with a fake measurer.
- On screen: `PageView` renders an `EditOverlay` per page: absolutely
  positioned white rectangles over each box and the laid-out text in a
  matching CSS font, scaled with the viewport. The overlay's text is in the
  DOM so it is selectable for a further rewrite; the selection mapper treats
  overlay lines as text items.
- Export: `buildDocument` accepts `edits`; after copying a page it draws, in
  unrotated page coordinates, `drawRectangle` in white over each box and
  `drawText` per laid-out line with an embedded standard font
  (`Helvetica`, `Helvetica-Bold`, or `Times-Roman` by the `font` field),
  using the same `layoutText` with pdf-lib's `widthOfTextAtSize` as the
  measurer so screen and export match.
- Font matching is approximate by design: the original embedded font is not
  reused. The spec for sub-project 4 may improve this.
- The Rewrite tab's "Insert into PDF" is disabled when `layoutText` reports
  overflow; the tab shows "Too long to fit; shorten the text" and lets the
  user edit the result inline before inserting.

## Data flow

1. User opens the AI panel → `ensureSession()` (Turnstile → `/session`).
2. User triggers a task → `documentText(scope)` → `runTask` → Worker
   validates, checks quota, calls Claude, streams deltas → store updates →
   tab renders progressively.
3. `done` → store updates `remaining`; Worker persists usage in KV.
4. Rewrite + Insert → `addEdit` → overlay renders → Download → pdf-lib
   applies edits.

## Error handling

| Condition | Behavior |
|---|---|
| Turnstile fails / siteverify down | Panel: "Couldn't verify you're human. Try again." Retry button. No AI call. |
| 401 expired session | Client re-runs Turnstile once and retries silently; second failure shows the message above. |
| 429 `daily_limit` | Panel: "Daily limit reached. Resets at HH:MM." Buttons disabled until then. |
| 429 `too_fast` | Panel: "Slow down a little." Retry allowed after 10 s. |
| 413 document too large | Client never sends it: scope switches to "selected pages" with "Document is too large to send whole; select pages." |
| 503 busy | "AI is busy, try again in a minute." |
| 502 upstream | "Something went wrong talking to the AI." |
| `stop: refusal` | "Claude declined this request." |
| Stream cut | Partial text stays, marker "response interrupted", Retry. |
| `max_tokens` | Partial text stays with "response was cut short". |
| Invalid body (zod) | 400; the client treats it as a bug and shows the generic message. |

The Worker never logs document text; it logs task, vid, status, and token
counts only.

## Testing

**Worker (`worker/`, Vitest with `@cloudflare/vitest-pool-workers`)**
- `prompts.test.ts`: `buildRequest(task, body)` yields the expected system
  prompt, document block with `cache_control`, effort per task, and the
  extract schema.
- `quota.test.ts`: 20 requests pass, 21st → `daily_limit`; token cap
  reached → `daily_limit`; key rolls over at UTC midnight (fake timers);
  `resetAt` is next UTC midnight.
- `session.test.ts`: sign → verify round trip; tampered signature rejected;
  expired rejected.
- `validate.test.ts`: good bodies pass, missing `question` for ask fails,
  oversized document fails with 413 payload.
- `handler.test.ts`: full `/ai` request with a mocked Anthropic client
  returning a scripted stream → SSE output has deltas and a `done` with
  usage; KV counter incremented; 401 without token; 429 when quota full;
  CORS headers present.
- `integration.test.ts` (skipped unless `ANTHROPIC_API_KEY` set): real
  summarize call on a two-page fixture returns non-empty text.

**Browser (Vitest, jsdom)**
- `text.test.ts`: with mocked `getTextContent`, pages return in list order
  with correct display page numbers; line joining; `hasAnyText`.
- `client.test.ts`: SSE parser handles events split across chunks and
  multiple events per chunk; 401 triggers one re-session.
- `ai.store.test.ts`: status transitions; reset on document change.
- `layout.test.ts`: wraps at region width; shrinks until it fits; reports
  overflow at 70 %.
- `document.test.ts` additions: `addEdit` then undo removes it; rotate
  keeps it; `remove` of the page drops it.
- `pageOps.test.ts` addition: export with one edit draws a white rectangle
  and the text on the right page (verified by decoding the page's content
  stream for the `re` operator and the text operand).

**Manual** (built-in browser, `wrangler dev` with Turnstile test keys):
summarize, ask with a citation click, select → simplify → insert → download
and reopen, extract → copy CSV, hit the burst limit.

## Deployment

- `worker/wrangler.jsonc`, `npm run worker:dev`, `npm run worker:deploy`.
- Secrets set with `wrangler secret put`. Deployment to the connected
  Cloudflare account happens only after explicit confirmation.
- App reads `VITE_AI_URL`; `.env.example` documents it. App hosting on
  Cloudflare is a separate short task after this sub-project works locally.

## Out of scope

OCR, accounts, paid tiers, usage dashboards, exact font matching for edits,
editing arbitrary lines by clicking (sub-project 4), annotations, forms.
