# In-place text editing — deferred items and rulings

Branch feat/text-editing, 2026-10-11. Final whole-branch review (Opus) found four Criticals, all fixed in one wave; a residual pass closed the two leftovers (unreachable-object sweep on flattened exports; central-band cover rule). Items below are deferred with a ruling.

## Rulings made during execution (also in the spec's Decisions table)
- Line baseline = min y of its items; paragraph join accepts gap ≥ 0.
- Colour quantisation floors to 16 levels (bucket-centre output).
- Library records carry `editsStamp` matched on equality; records built while edits exist stay in memory only. Edited text never persists in the search library.
- `Edit.region` persists the original block box; `frame` holds a moved text position; covers always span the region (`coverBoxes`, epsilon 0.01).
- A font change re-lays out the edit (one undo step).
- Layout tolerance: a line wraps only when it exceeds width × 1.05 + 1 pt; baseline = block top − font size.
- Edited pages (typed and scanned) are flattened on download: 200 DPI raster capped at 16 MP with covers baked in, old content streams and all unreachable objects removed, invisible text layer from the edited extracted text (Deep OCR pages get no invisible layer, with a warning). Flatten failure restores the page and warns `Saved without flattening; covered text may remain in the file.`
- Edits are NOT written into the persistent OCR store (reverses the design's "rewrite the OCR store" decision): the extraction overlay, export drawing and flatten already give search, AI and the saved file the edited text. A reopened scan shows its original OCR text until re-edited.
- `blockKey` no longer replaces edits; reopening is by hit-test on the edit's boxes.
- First click on an existing edit selects it (handles); clicking its body reopens.
- Native text items are converted to crop-relative coordinates in `extractPageText`.
- Cover rule: an item is covered when a cover overlaps it horizontally and reaches its central vertical band.

## Follow-ups worth doing
- Two columns on one baseline merge into one line in block detection (label/value clinical forms).
- `hideCoveredSpans` approximates the central band from the span rect; near-graze cases can differ from extraction.
- Unflattened saves (no rasterizer, or flatten failure) still carry orphaned original objects.
- OCR neighbour lines overlapping a cover by > 0.2 h are dropped from extraction.
- In-memory edited library records are not evicted when the document closes (session-only search hits).
- A cover from one edit can paint over another edit's moved text (draw order).
- Flatten progress UI for large documents; non-WinAnsi characters become `?` in invisible layers; one invisible "word" per pdf.js item.
- Select-then-reopen has no cue; drag preview moves only the frame; no keyboard path to handles; accessibility roles on the editor; approximate caret.

## Small deferred minors (from per-task reviews)
export font cache per page · updateEdit on an unknown id commits a no-op undo entry · RewriteTab/TextLayer/PageView lint warnings · whitespace-only items can form empty lines · join drift chains paragraphs · `blockAt` first-match on overlap · colour sort cost and transparent-black edge bias · `fontInfo` fallback never fills weight/style · `/mono|book/` over-match · stamps never cleared · same-millisecond stamp collision · O(n²) subscription lookups · missing tests: gap-0 boundary, S→S′ re-index, sampleBlockColors DOM, pointer-capture handlers, routing messages, OCR partial-line edit.
