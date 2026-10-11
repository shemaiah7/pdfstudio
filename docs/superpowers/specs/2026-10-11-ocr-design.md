# OCR for scanned PDFs — design

Date: 2026-10-11. Sub-project 5 of PDF Studio.

## Goal

Scanned PDFs (typed printouts, faxes, forms with tables, handwritten notes, phone photos of paper) currently have no text, so Summarize, Ask, Extract, Search, and text selection do nothing. This sub-project recovers the text so every existing text feature works on scans, and writes it into the saved PDF so other readers can search it too.

## Decisions

| Question | Decision |
| --- | --- |
| Privacy stance | Local first, cloud opt-in. Typed pages are read on the device. "Deep OCR" sends chosen pages as images to the AI worker. |
| Local engine | Tesseract.js 7 (Apache-2.0, WebAssembly, no WebGPU needed). |
| Cloud engine | Claude Sonnet 5.5 through the existing Cloudflare AI worker, new `ocr` task. |
| Trigger | Local OCR runs automatically when a document with text-less pages opens. Deep OCR is always a button. |
| Output | Text powers the app (selection, AI, search) and is written into the downloaded PDF as an invisible text layer. |
| Rejected | Florence-2 in the browser (WebGPU-only, no handwriting gain). Hosted OCR APIs other than Claude (weaker handwriting, second data processor). |

## Architecture

```
open file ──► document store ──► detect text-less pages ──► OCR queue (Tesseract worker)
                                                                  │
Deep OCR button ─────────────────────────────► Claude engine ──► OcrStore (IndexedDB)
                                                                  │
extractPageText ◄── pdf.js items, else OcrStore ──► AI tasks, search indexer, text layer, selection
                                                                  │
download ──► addTextLayer (pdf-lib, invisible text) ◄─────────────┘
```

### Module `src/ocr/`

- `types.ts`
  - `OcrBox = { x, y, width, height }` in PDF user-space points, origin bottom-left, for the unrotated page.
  - `OcrWord = { text: string; box: OcrBox; confidence: number }` (confidence 0–1).
  - `OcrLine = { text: string; box: OcrBox; words: OcrWord[] }`.
  - `OcrPage = { engine: "tesseract" | "claude"; lines: OcrLine[]; confidence: number; at: number }`.
  - `OcrEngine = { recognize(image: ImageBitmap, meta: { widthPt, heightPt }, signal?: AbortSignal): Promise<OcrPage> }`.
- `raster.ts`: `rasterizePage(source, pageIndex, { maxEdge }): Promise<{ bitmap: ImageBitmap; widthPt; heightPt; scale }>`. Renders through the existing `getPage` and pdf.js canvas render at scale = min(300/72, maxEdge / longest side in points). `maxEdge` is 2500 px for Tesseract and 1568 px for Claude. The page is rendered at rotation 0; boxes are therefore relative to the unrotated page, matching pdf.js text content.
- `tesseractEngine.ts` + `tesseractWorker.ts`: a Web Worker owning one Tesseract.js worker (`createWorker("eng")`). `langPath` points at the jsDelivr tessdata CDN (`https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int`), the browser caches the data; the `workerPath` and `corePath` are bundled by Vite from `node_modules/tesseract.js` and `tesseract.js-core`. The worker receives `{ id, bitmap, scale, widthPt, heightPt }`, runs `recognize` with `blocks: true`, converts the result's lines and words to `OcrPage` by dividing pixel boxes by `scale` and flipping y (`y = heightPt - (y0 + h) / scale`). Confidence is the mean word confidence / 100. The main-thread client mirrors `embedClient`: `load()`, `recognize()`, `cancel(id)`, `dispose()`; promises are rejected with `"cancelled"` or `"disposed"` the same way.
- `claudeEngine.ts`: encodes the bitmap as JPEG (quality 0.85, re-encoded at a smaller edge until the file is under 4 MB), posts to the worker with `task: "ocr"`, and receives `{ lines: string[] }`. Boxes are synthesised: lines stacked evenly down the page with a 36 pt side margin, line height = (heightPt − 72) / lines.length capped at 14 pt, width = widthPt − 72. Words split on whitespace, each word's box is a proportional slice of the line width by character count, confidence 0.9 for every word.
- `store.ts`: `OcrStore` over IndexedDB `pdfstudio-ocr` v1, object store `pages` keyed by `${hash}:${pageIndex}`, value `OcrPage & { hash; pageIndex }`. Same `idb` pattern and memory overlay on write failure as `src/search/library.ts`. `get(hash, page)`, `put(hash, page, OcrPage)`, `delete(hash)`, `clear()`. Keyed by the file's SHA-256 so a re-opened scan is instant.
- `queue.ts`: `OcrQueue` serialises jobs: `enqueue(sourceId, pageIndex, engine)`, `cancelSource(sourceId)`, `cancelAll()`. One job at a time per engine (Tesseract is single-threaded; Claude jobs batch up to 20 pages per request). Emits `{ sourceId, pageIndex, state: "queued" | "running" | "done" | "failed" | "empty" }` to the OCR store slice. A page timed out after 60 s is marked `failed`; the queue continues.

### Store `src/store/ocr.ts`

`useOcrStore`:

- `enabled: boolean` from localStorage `pdfstudio.ocr.auto` (default true).
- `pages: Map<string /* sourceId:page */, { state; engine?; error? }>`.
- `engineStatus: "idle" | "loading" | "ready" | "unavailable"` for Tesseract, with `retry()`.
- `scanSource(source)`: for each page, `extractPageText` gives zero items → check `OcrStore` by hash; hit → `done`; miss and `enabled` → enqueue Tesseract.
- `deepOcr(pageEntryIds | "all-scanned")`: confirmation flag `deepOcrAcknowledged` (session only); enqueues Claude jobs; results overwrite the store entry for that page.
- `retryPage(sourceId, page)`, `cancelAll()`.
- Subscribes to `useDocumentStore` source additions and removals (the existing `sourceReleasers` hook) to start scans and cancel jobs.

### Merge point `src/pdf/text.ts`

`extractPageText` keeps its signature. After `getTextContent`, if `items.length === 0` and the OCR store has a page for `(hash(source.bytes), pageIndex)`, it returns `{ text, items }` built from the OCR lines: one `TextItemBox` per word (`fontSize = line box height`), `text` from the lines joined by `\n` (word order as recognised, lines top to bottom). The text cache entry for that page is cleared when the OCR store writes a result for it, so the next call sees the new text. A `source` gains an optional `hash` field computed once on open in `loadSources` (SHA-256 already exists in `src/search/library.ts`; move it to `src/pdf/hash.ts` and import it from both).

`hasAnyText` is unchanged; because it reads merged text, Summarize and Ask work on scans as soon as OCR finishes.

### Text layer `src/components/TextLayer.tsx`

When pdf.js text content has no items and the OCR store has a page, the component builds a pdf.js-compatible `textContentSource` (`{ items: [{ str, transform: [h, 0, 0, h, x, y], width, height, dir: "ltr", fontName: "ocr", hasEOL }], styles: { ocr: { fontFamily: "sans-serif", ascent: 0.9, descent: -0.2 } } }`) from the OCR words and renders it with the same `pdfjs.TextLayer`, so selection, highlight annotation, and the Edit overlay behave exactly as on native pages. It re-renders when the OCR store entry for the page changes.

### Search `src/search/indexer.ts`

Unchanged in logic: it calls `extract`, which now returns OCR text. The library record gains `ocrVersion: number` (the newest `at` among the source's OCR pages, 0 when none). `indexSource` treats a cached record with an older `ocrVersion` than the current one as a miss and re-indexes. The search store re-runs `indexOpen` for a source when the OCR queue finishes a page of it (debounced 2 s).

### Worker `worker/src/`

- `validate.ts`: new task `ocr`: `{ task: "ocr", pages: { page: number; image: string /* base64 JPEG */ }[] }`, 1–20 pages, each image ≤ 4 MB decoded (≈5.4 MB base64), total body ≤ 60 MB. `document` is not required for this task.
- `prompts/ocr.ts`: "Transcribe all text on this page image exactly as written, line by line, top to bottom, left to right. Preserve table rows as single lines with cells separated by ` | `. Transcribe handwriting as faithfully as possible; write `[illegible]` for words you cannot read. Output only the transcription, one line per text line, no commentary."
- `request.ts`: for `ocr`, one Messages call per page (so a failed page does not fail the batch), `max_tokens` 4000, image block `{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }`, no document block, effort `"low"`. The response is split on newlines into `lines`. Pages are processed sequentially within the request; the handler returns `{ pages: { page, lines }[] , failed: number[] }` as JSON (not streamed).
- `index.ts`: route `ocr` through the same Turnstile and KV quota checks; quota counts each page as one AI request.

### Export `src/pdf/download.ts` / new `src/pdf/textLayer.ts`

`addInvisibleText(pdfDoc: PDFDocument, pageIndex: number, ocr: OcrPage, pageSize: { widthPt; heightPt })`: embeds Helvetica once per document and, for each word, draws it with text render mode 3 (invisible) at the word box, font size = box height × 0.9, horizontally scaled so the word width matches the box (`Tz` operator via a content stream, or `pdf-lib`'s `drawText` with `xScale`-equivalent via `pushOperators`). Non-WinAnsi characters are replaced with `?` (reuse `src/pdf/winansi.ts`). Called from the download path for every page whose OCR entry exists and whose pdf.js text content is empty, before annotations are flattened. Failure is caught, logged, and reported once per download as a toast; the PDF still saves.

## User interface

- **Page badge** on thumbnails and page views for scanned pages only: "Recognizing…", "Text recognized", "Deep OCR", "No text found", "Failed · Retry".
- **Toolbar pill** "Recognizing text 3/12" with a cancel button while Tesseract jobs run; hidden when idle.
- **Deep OCR menu** in the toolbar: "This page", "Selected pages", "All scanned pages". First use per session opens a confirmation sheet: "Deep OCR sends images of N page(s) to the AI service for transcription. Text stays on this device afterwards." with Continue / Cancel. It reuses the Turnstile gate from the AI tab.
- **AI tab and Search messages**: while pages of the open document are queued or running, Summarize/Ask/Search show "Recognizing text… try again in a moment." When all scanned pages ended `empty` or `failed`, they show "No text could be recognized. Try Deep OCR."
- **Setting** "Recognize text automatically" (default on) in the settings popover, persisted to localStorage `pdfstudio.ocr.auto`.
- **Clear all** in the Library panel also clears the OCR store.
- Privacy page (owed from earlier sub-projects) gains a paragraph: Tesseract language data is downloaded from jsDelivr; Deep OCR sends page images to the AI worker and Anthropic.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Tesseract worker fails to load (CDN down, no WebAssembly) | `engineStatus = "unavailable"`, pill shows "Text recognition unavailable · Retry". Deep OCR still works. |
| Page throws or exceeds 60 s | Page marked `failed` with Retry; queue continues with the next page. |
| Tesseract finds no words (confidence < 0.3 or zero words) | Page marked `empty`; badge "No text found"; nothing stored, so a later Deep OCR fills it. |
| Deep OCR image > 4 MB after JPEG at 1568 px | Re-encode at 1200 px, then 900 px; if still too big, fail the page with "Page image too large". |
| Worker returns 413 / 429 / 5xx | Toast with the existing AI error copy; affected pages keep their Tesseract text and are marked `failed` for Deep OCR only. |
| Turnstile not completed | Same prompt as the AI tab. |
| IndexedDB write fails | Memory overlay for the session plus one toast "OCR text could not be saved; it will be recognized again next time." |
| Text layer cannot be added on download | PDF saves without it; toast "Saved without searchable text layer." |
| File re-opened with a different hash (edited bytes) | Treated as a new source; OCR re-runs. |

## Testing

Unit (Vitest):
- `tesseractWorker` box conversion: pixel boxes at scale 2 → points with y flipped.
- `claudeEngine` line stacking: N lines fill the page with the expected boxes; word slices sum to the line width.
- `extractPageText` merge: pdf.js items present → unchanged; none and OCR present → OCR text and items; OCR write clears the cache.
- `OcrStore` get/put/delete/clear with `fake-indexeddb`; memory overlay on write failure.
- `OcrQueue`: ordering, cancel by source, timeout marks `failed` and continues.
- `addInvisibleText`: output parsed with pdf.js, `getTextContent` returns the words at positions within 1 pt of the boxes; non-WinAnsi replaced.
- Worker: `validate.ts` accepts 1–20 pages, rejects 0, 21, and oversize images; `request.ts` builds an image block and no document block; handler splits lines and reports failed pages.
- Store: `scanSource` enqueues only text-less pages; `enabled=false` enqueues nothing; messages switch between "Recognizing…" and "No text could be recognized".

Integration (Vitest, real Tesseract.js in Node):
- A fixture built by `scripts/make-fixtures.ts`: a pdf-lib page with known words rendered to PNG at 200 DPI and re-embedded as an image-only PDF (`fixtures/scan.pdf`). Running the Tesseract engine on it yields text containing the known words with confidence > 0.6.

E2E (Playwright, gated by `E2E_OCR=1`):
- Open `fixtures/scan.pdf`; the badge reaches "Text recognized"; Search finds a known word; Summarize no longer shows the no-text message (AI request mocked).
- Deep OCR against a mocked worker route returning fixed lines: the badge shows "Deep OCR" and the text layer contains the lines.
- Download: the saved PDF, parsed with pdf.js, contains the recognized words.

## Non-goals

- Languages other than English (the language path is a constant; adding languages is a follow-up).
- Layout reconstruction (columns, reading order beyond top-to-bottom lines).
- Editing OCR text by hand.
- Running OCR on pages that already have text, or detecting "text is garbage" pages.
- The vision encoder of EmbeddingGemma 2 for image search.
