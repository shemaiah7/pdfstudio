# OCR sub-project — deferred items and rulings

Branch feat/ocr, 2026-10-11. Final whole-branch review: all Critical/Important findings fixed (f25dbb1). Items below are deferred with a ruling.

## Follow-ups worth doing soon
- **Batch and pace Deep OCR on the client.** The worker reserves whole batches, but the client sends one page per request; "All scanned pages" beyond ~5 pages/minute or 20/day hits `too_fast`/`daily_limit`. Batch up to 20 pages, pace on `resetAt`, and show the count against the remaining quota in the confirmation.
- **"This page" should be the visible page.** Today it sends the first selected scanned page, else the first scanned page of the document. Track the page in view.
- **Fax-style pages.** Pages with a few native text items (headers, stamps) are never OCR'd and cannot be targeted by Deep OCR. Treat pages whose native text is tiny relative to the page area as scanned.
- **No UI cancel for Deep OCR.** The pill cancels Tesseract only; `cancelAll` is store-only.
- **Mark OCR-derived pages in the AI payload** so summaries hedge on garbled doses/names.
- **Self-host the Tesseract worker/core scripts** (currently Tesseract's jsDelivr defaults; language data from jsDelivr too).
- **Deep OCR after a quota refusal does not set `limitedUntil`** in the AI panel (only a success reporting 0 requests left does).
- **Sideways pages.** Rasterisation ignores `/Rotate`; scans stored sideways OCR poorly. Render at the page rotation and map boxes back.
- **Claude lane timeout** is the same 60 s as Tesseract; a dense page can time out client-side while the worker still charges it.
- **The recognition gate is document-wide.** Summarize/Ask/Extract refuse while any page (including Deep OCR) is queued/running, even for Ask on selected native pages.
- **Cancel mid-scan leaves unreached pages unclassified** (no badge, no Retry, excluded from "all scanned") until Clear all or reopen; `deepOcr`/`retryEngine` loops are not epoch-guarded.

## Rulings recorded during execution
- OCR boxes are relative to the crop-box origin (pdf.js `page.view`); `TextLayer` adds the origin, export adds `cropOrigin`.
- Tesseract worker/core from jsDelivr defaults, no custom Web Worker.
- Worker `/ocr` reserves the whole batch in one quota call (`weight`).
- A Deep OCR page with any edit box gets no invisible text layer (synthetic boxes cannot guarantee redaction); Tesseract pages drop words under edit boxes.
- Cancel marks queued/running pages failed/"cancelled" so Retry appears; the pill cancels the Tesseract lane only.
- Clear all (Library) clears OCR, invalidates the text cache, and re-scans open documents.
- The plan-mandated `react-refresh/only-export-components` warning on `TextLayer.tsx` is tolerated (same pattern elsewhere); move `ocrTextContent` to `src/ocr/` when convenient.

## Small deferred minors (from per-task reviews)
layout: negative sizes for pages < 72 pt, scale 0 → Infinity · store: `remove()` leaves rows on delete failure, literal U+FFFF, thin key-format test · tesseract engine: dispose/recognize race, caret version ranges, network-dependent real-OCR test, non-deterministic fixture script · worker: 60 MB body cap vs 20×5.4 MB, sequential pages, hard-coded `image/jpeg`, empty text counts as success · text.ts: OCR items are crop-relative while native items are absolute (no consumer reads positions today) · queue: throws from `onState` unhandled · search: in-flight index job not aborted on re-index, debounce timer survives clearLibrary · textLayer: annotations ignored by the covered-word filter (shapes are unfilled), no Toolbar test · UI: `<details>` menu never auto-closes, no aria roles on badge, possible badge/label overlap, test leaks store overrides, console noise · e2e: Deep OCR test does not assert Tesseract text gone; `/ai` body not asserted; `window.confirm` assumed.
