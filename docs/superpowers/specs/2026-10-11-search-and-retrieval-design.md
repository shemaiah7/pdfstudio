# PDF Studio: Search and Retrieval (Sub-project "search")

Date: 2026-10-11
Status: Draft for review
Depends on: sub-projects 1 to 3 (merged to `main`, deployed).
Comes before: OCR (roadmap item 5). Scanned pages have no text and are not
searchable until OCR lands; this design must not make that harder.

## Goal

Let a visitor find passages by meaning across every document they have
opened in this browser, and let Ask answer from the relevant passages
instead of the whole file, so large and multiple documents work within the
per-visitor quota. Everything runs in the browser: the embedding model is
downloaded once, document text and vectors never leave the machine.

## Decisions already made

- Model: EmbeddingGemma 2, text-only load, from
  `onnx-community/embeddinggemma-2-ONNX` through transformers.js
  (`@huggingface/transformers` 4.x), dtype `q4` (about 160 MB), device
  `webgpu` with `wasm` fallback. Apache 2.0 licence. 768-dimension output
  truncated to 256 and re-normalised (Matryoshka; the model card reports
  61.4 → 60.4 MTEB multilingual at 256d).
- Runs in the browser only. No server-side embedding, no Cloudflare
  Vectorize.
- Opt-in: nothing downloads until the user clicks "Enable search" once.
- Persistent local library in IndexedDB, keyed by content hash, storing
  the PDF bytes so hits in closed documents can open them at the page.
- Surfaces: a Search tab, a Library view, retrieval-backed Ask, and
  "Find similar" from a search result.
- Approach A: hand-rolled chunking, brute-force cosine ranking in memory
  with a light exact-term boost. No search-engine dependency.
- Out of scope: the vision encoder for scanned pages (stretch goal after
  OCR), multi-device sync, keyword query operators, re-ranking models.

## Users and success criteria

- Open a 150-page typed guideline, enable search, and within a minute on
  a laptop search "dosing adjustment in renal impairment" and land on the
  right page even though the page uses different words.
- Open three discharge summaries, ask "which patients are on warfarin",
  and get an answer citing the right pages, with only excerpts sent to
  the AI worker.
- Close the tab, come back tomorrow, search the same query: the hit is
  there, clicking it opens the stored file at the page.
- On a machine without WebGPU the feature still works, only slower, and
  says so.
- A scanned PDF shows "No searchable text" and does not break anything.

## Components (`src/search/`)

### `embedWorker.ts` (Web Worker)
Owns the model. Messages:

```ts
type In  = { type: "load" } | { type: "embed"; id: number; texts: string[]; kind: "query" | "document" } | { type: "dispose" };
type Out = { type: "progress"; loaded: number; total: number } | { type: "ready"; device: "webgpu" | "wasm" }
         | { type: "embedded"; id: number; vectors: Float32Array; dims: 256 } | { type: "error"; id?: number; message: string };
```

- Loads with `pipeline("feature-extraction", MODEL_ID, { dtype: "q4", device, progress_callback })`; tries `webgpu`, on failure `wasm`.
- Applies prefixes itself: documents `title: none | text: `, queries
  `task: search result | query: `. Callers never add them.
- Truncates each 768-d vector to the first 256 values and re-normalises
  to unit length; returns one flat `Float32Array` of `texts.length × 256`.
- Batches of up to 16 texts per model call; the caller batches above that.

### `embedClient.ts`
Promise wrapper over the worker: `load(onProgress)`, `embed(texts, kind)`,
`dispose()`. One instance per app (`getEmbedClient()`). Jobs run in order;
`cancel(tag)` drops queued jobs with that tag (used when a document closes
mid-index).

### `chunker.ts` (pure)
`chunkPage(pageIndex, text): Chunk[]` with
`Chunk = { page: number; start: number; end: number; text: string }`.
Words are whitespace-delimited; a chunk is 200 words, the next starts 160
words later (40-word overlap). A chunk never crosses a page. `start`/`end`
are character offsets into the page's extracted text so the text layer can
highlight the span. Pages with fewer than 3 words produce no chunk.

### `library.ts`
IndexedDB through `idb`: database `pdfstudio-search`, store `documents`
keyed by `hash` (hex SHA-256 of the file bytes, via `crypto.subtle`).

```ts
interface LibraryRecord {
  hash: string; name: string; size: number; pageCount: number; addedAt: number;
  modelId: string;                 // MODEL_ID + "@256"
  bytes: Blob;                     // original PDF
  chunks: Chunk[];                 // zero chunks for a document with no text
  vectors: Float32Array;           // chunks.length × 256, empty when no chunks
}
```

API: `put(record)`, `get(hash)`, `list(): Omit<LibraryRecord, "bytes"|"vectors">[]`,
`loadVectors(hash)`, `remove(hash)`, `clear()`, `estimateUsage()` (navigator.storage.estimate).
On first search the store loads every record's chunks and vectors into
memory (`Map<hash, {chunks, vectors}>`); records are added to the map as
they are indexed and dropped on remove. If IndexedDB is unavailable or a
write fails with a quota error, the library falls back to the in-memory
map for the session and sets `persistent: false`.

### `indexer.ts`
`indexSource(source: SourceFile, onProgress): Promise<IndexResult>`:

1. Hash the bytes. If the library has the hash with the current `modelId`,
   return `{ status: "cached" }`.
2. Extract page text with the existing `documentText` helper, chunk every
   page.
3. Embed chunks in batches of 16 with tag = hash; report progress as pages
   done / total.
4. Write one record; return `{ status: "indexed", chunks: n }`.
   Zero chunks still writes a record (so scans are not retried).
5. Any thrown error returns `{ status: "failed", message }` and writes
   nothing.

One document indexes at a time; a queue in the store orders them by open
order.

### `ranker.ts` (pure)
`rank(query: Float32Array, docs: RankDoc[], terms: string[], opts): Hit[]`:

- score = cosine (dot product, vectors are unit length) + boost, where
  boost = 0.05 per distinct query term of 3+ characters found
  case-insensitively in the chunk text, capped at 0.15.
- Drop hits with score < 0.3.
- Diversity: at most 3 hits per document in the first 10 results.
- Return the top `limit` (default 20) as
  `{ hash, page, chunkIndex, score, snippet }`, snippet being the chunk text
  trimmed to 240 characters around the first boosted term, or the start.

Query terms come from the query split on non-letters, lowercased, stop
words removed (a short built-in list).

### `src/store/search.ts` (Zustand)

```ts
interface SearchState {
  enabled: boolean;                               // localStorage "pdfstudio.search.enabled"
  model: { status: "idle" | "downloading" | "ready" | "unavailable"; loaded: number; total: number; device?: "webgpu" | "wasm"; error?: string };
  docs: Record<hash, { status: "queued" | "indexing" | "indexed" | "no-text" | "failed"; done: number; total: number; error?: string }>;
  hashBySource: Record<SourceId, string>;         // filled as each open source is hashed
  persistent: boolean;
  query: string; results: Hit[]; searching: boolean;
  library: LibrarySummary[];
  enable(): void; retryModel(): void; indexOpen(): void; retryDoc(hash): void;
  setQuery(q): void; search(): Promise<void>; findSimilar(hash, chunkIndex): Promise<void>;
  openHit(hit): Promise<void>; removeFromLibrary(hash): Promise<void>; clearLibrary(): Promise<void>;
}
```

`search()` is debounced 250 ms from `setQuery`. `indexOpen()` runs when
the model becomes ready and whenever sources change. `openHit` looks up
the hit's hash in `hashBySource`; when a matching source is open it finds
that source's page entry for the hit's page index in the document store,
scrolls to it and flashes the chunk span on the text layer; otherwise it
loads the stored bytes through the normal `addFiles` path, then scrolls.
"Find similar" is offered on each result hit and uses that chunk's stored
vector as the query.

### UI
- `SearchTab.tsx` in the right panel next to Summarize/Ask/Rewrite/Extract.
  Disabled state: a short notice ("Downloads a 160 MB model once; documents
  stay on this device") and an Enable button. Downloading: progress bar
  with MB. Ready: search box, per-open-document index status line, results
  list (document name, page, snippet, score hidden), each with "Find
  similar". No WebGPU: the notice adds "Indexing will be slower on this
  device".
- `LibraryPanel.tsx`: opened from a Library button in the Search tab.
  Lists records with name, pages, size, added date, index status; Remove
  per row; Clear all with confirm; total usage line; a sentence stating
  documents are stored on this device only.
- Text layer: a `flashSpan(pageEntryId, start, end)` helper adds a
  temporary highlight class to the text layer spans that overlap the
  offsets, 2 seconds.
- `AskTab`: a "Use search" toggle, default on when the model is ready,
  hidden otherwise. With it on, the request carries `retrieved: true` and
  the top 12 passages over the open documents; the panel shows "Answering
  from 12 passages" under the question.

### Worker (`worker/`)
- `AiRequest` gains `retrieved?: boolean`. Validation: when true, at most
  40 `document` entries and each at most 4 000 characters.
- The ask prompt, when `retrieved`, says the material is a set of excerpts
  from the user's documents with page numbers, that the answer must cite
  pages and must say when the excerpts do not contain the answer.
- Quota accounting unchanged.

## Data flow

1. Enable → store sets `enabled`, worker loads, progress shown; transformers.js caches model files in the browser Cache API so later visits load from disk.
2. Model ready → `indexOpen()` queues every open source: cached hashes are marked indexed at once, new ones are chunked, embedded and stored. Scans produce a zero-chunk record and the "No searchable text" status.
3. Search → query embedded, ranked over every in-memory library document (open or not), top 20 shown. Hits in open documents scroll and flash; hits in closed ones show "Open".
4. Ask with retrieval → question embedded, ranked over open documents only, top 12 chunks sent as excerpts. Falls back to the whole-document request when the model is not ready or no chunk clears 0.3 and the document is under 600 000 characters; otherwise shows "Nothing in the open documents matched the question".
5. Find similar → the chunk's stored vector is the query; the originating chunk is excluded.
6. Library → list, remove, clear; clear also resets `enabled`.

## Error handling

| Condition | Behaviour |
|---|---|
| No WebGPU | WASM; notice says slower |
| Model download fails or is interrupted | `unavailable` with Retry; Ask keeps the whole-document path |
| Worker error mid-index | Document `failed` with Retry; the queue continues |
| IndexedDB unavailable or quota exceeded | In-memory library for the session; notice "Documents won't be remembered on this device" |
| Document has no text | Zero-chunk record; status `no-text` |
| No hit above 0.3 | "No matches" |
| Retrieved Ask without passages | Fallback described above |
| Stored record from another `modelId` | Treated as absent; re-indexed on next open, old record replaced |
| Document closed mid-index | Queued embed jobs cancelled by tag; nothing written |

## Privacy

Model files are fetched from Hugging Face's CDN over HTTPS. Document text,
vectors and bytes stay in the browser. The Library view states this and
shows total storage. Clearing the library removes everything the feature
stored. The existing privacy-page obligation (Turnstile addendum) gains a
sentence about the model download and local storage.

## Testing

- `chunker.test.ts`: window and overlap, no page crossing, offsets reconstruct text, empty pages.
- `ranker.test.ts`: cosine ordering, boost and cap, diversity, threshold, snippet window.
- `library.test.ts` (fake-indexeddb): put/get/list/remove/clear, Float32Array round-trip, stale `modelId` reported.
- `indexer.test.ts` (stub embed client): cached hash skips embedding; new file produces one record with the expected chunk count; a thrown embed marks failed and does not affect the next document; a closed document cancels.
- `store/search.test.ts`: status transitions, debounce, Ask fallback decisions.
- Worker tests: `retrieved` prompt selected, 40-passage cap, quota still charged.
- `scripts/search-smoke.ts` (on demand, Node, CPU): loads the real model, checks a cardiac query ranks a cardiac passage above a dermatology one, and that prefixes are applied (query vs document embeddings differ for the same text).
- Component tests: enable notice and progress, results rendering, hit click calls scroll, Library remove.
- Playwright `e2e/search.spec.ts` behind `E2E_SEARCH=1`: open `three.pdf`, enable, wait for indexed, search a page's text, expect a hit on that page. Skipped by default.
- Manual: 150-page PDF without WebGPU; the deployed app on a phone.

## Global constraints

- `@huggingface/transformers` ^4.3; `idb` ^8; no other new runtime dependencies.
- Model id constant `MODEL_ID = "onnx-community/embeddinggemma-2-ONNX"`, dims 256, chunk 200/40 words, threshold 0.3, boost 0.05 capped 0.15, top-k 20 (search) and 12 (Ask), Ask cap 40 passages × 4 000 chars.
- Worker files are loaded with Vite's `new Worker(new URL(..., import.meta.url), { type: "module" })`.
- Copy: "Enable search", "No searchable text", "Documents won't be remembered on this device", "Answering from N passages", "Nothing in the open documents matched the question".
