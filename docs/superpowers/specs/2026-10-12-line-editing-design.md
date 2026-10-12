# Line editing with styled runs — design

Date: 2026-10-12. Revision of the text-editing feature (sub-project 4, spec `2026-10-11-text-editing-design.md`).

## Problem

Three things the user met on a clinical QA report:

1. The editor grabs an automatically detected "block". Lines are grouped by baseline only, so two columns on one row ("Type Fall" / "Finger Stick") merged into one line and the block spanned both columns.
2. The block is re-rendered in one font, so bold labels on the same line as regular values came back regular.
3. A faint gray cover remained after Done (fixed separately in 8fd807b: the colour sampler now averages the dominant bucket instead of returning its centre).

## Goal

The user draws a box over what to change. Inside it, each text line is its own field, pre-styled with its real runs (bold, regular, italic, size). Only changed lines become edits; nothing else on the page is touched. Export, search, OCR layering, and the move/width handles keep working.

## Decisions

| Question | Decision |
| --- | --- |
| Targeting | Drag a box in the Edit tool; a click without movement targets the single line under the pointer. No automatic multi-line grouping. |
| Fields | One field per line (not a paragraph). Enter or Done applies all; Escape cancels all; Tab moves to the next field. |
| Styling | Per-run fonts from the twelve standard faces matched as today, per run. Typing inherits the run at the caret. |
| Wrapping | None. Runs are laid left to right from the line's x. Overflow past the drawn box shows a warning and still applies. |
| Columns | Lines split at horizontal gaps wider than 1.2 em. |
| Deleting | An emptied field whites out the line (cover, no runs). |
| Legacy | Existing block edits (`Edit` without `runs`) keep rendering, exporting, and reopening exactly as today. New editing always produces line edits. |
| Rejected | Paragraph editor with re-wrapping across mixed-font lines (approach C); single dominant font per line (approach B). |

## Model (`src/pdf/types.ts`)

```ts
export interface Run { text: string; font: EditFont; fontSize: number; color: RGB }
export interface Edit {
  id: string; pageEntryId: string;
  // legacy block fields (unchanged): boxes, text, fontSize, font, color, background?, lineHeight?, source?, blockKey?, region?, frame?
  // line edit:
  kind?: "line";                 // undefined = legacy block edit
  runs?: Run[];                  // ordered left to right; empty array = whited-out line
  x?: number; baseline?: number; // start of the first run, crop-relative points (frame overrides when moved)
}
```
For a line edit: `region` is the original line's box (required), `frame` is set only after a move or width change, `boxes` is derived (`region`, plus `frame`'s box when moved) and kept for the existing cover/extraction code, `background` is sampled, `text` is the runs' text joined (kept so existing consumers such as search records and the Deep OCR gate keep working), `font`/`fontSize`/`color` mirror the first run (legacy consumers), `source` as today.

## Detection (`src/edit/blocks.ts`, `src/edit/runs.ts`)

- `linesFrom(items)`: unchanged baseline grouping, then each group is split where `next.x - (prev.x + prev.width) > 1.2 * prev.fontSize`. Each resulting `TextLine` gains `runs: TextRun[]` where `TextRun = { items: TextItemBox[]; text: string; fontName: string; fontSize: number }`, built by merging consecutive items with equal `fontName` and `|fontSize| within 2 %`.
- `linesInBox(lines, box)`: lines whose box overlaps `box` vertically by at least half the line's height and horizontally by at least one glyph (`fontSize * 0.5`).
- `lineAt(lines, x, y)`: the line whose box contains the point (tolerance 2 pt).
- `blocksFrom` stays for legacy tests and `itemsToOcrPage`; the editor no longer uses it.
- Run styling: `runStyle(run, styles, fontInfo)` → `{ font: EditFont; color: RGB }` using `fontInfoFor` + `matchFont` per run; the fill colour comes from pdf.js when the text content exposes it, otherwise from `sampleColors` on the run's box (darkest 5 %).

## Editor (`src/components/LineEditor.tsx`, replaces `BlockEditor` for new edits)

- Props: `{ open: OpenLines; scale; heightPt; onClose }` where `OpenLines = { entry; source; box: Box; lines: OpenLine[]; background: RGB }` and `OpenLine = { line: TextLine; runs: Run[]; existing?: Edit }`.
- Renders one contenteditable per line positioned at `(line.x, line.baseline)` scaled, width = max(line width, drawn box right − line.x). Runs are `<span data-run>` elements with `font` from `FONT_CSS` and the run's colour. A `beforeinput` handler keeps typing inside the caret's span; `insertFromPaste` inserts plain text into the caret's span; a span emptied by deletion is removed. Reading back: `[...el.querySelectorAll("[data-run]")]` → runs (spans without text dropped).
- Width check per field: total run width (pdf-lib metrics, `measureFor`) > `box.x + box.width − line.x` → class `overflow` and the note "Text wider than the box".
- Apply: for each field whose runs differ from the original (text, font, or size), `addEdit` a line edit (or `updateEdit` the reopened one), with `region = line.box`, `background = open.background`, `boxes = [region]`, `text = runs.map(r => r.text).join("")`, legacy mirrors as above. Unchanged lines create nothing.
- Keys: Enter and Done apply; Escape cancels; Tab/Shift+Tab move between fields; clicking outside applies (as today).

## Targeting (`src/components/PageView.tsx`, `src/components/DragBox.tsx`)

- In the Edit tool, pointer-down starts a `DragBox` overlay; pointer-up with movement < 3 px is a click. Click: `lineAt` under the pointer (or an existing edit under the pointer → reopen). Drag: `linesInBox` with the drawn box in page points; zero lines → hint "No text here to edit".
- Existing edits under a drag box are included as reopenable lines (their runs loaded from the edit); legacy block edits under the box are not included (they reopen only by click, as today).
- `BlockHint` (hover highlight) highlights the single line under the pointer.

## Layout, overlay, export, extraction

- `src/edit/lineLayout.ts`: `placeRuns(edit, measures)` → `{ runs: { run, x }[]; boxes: Box[] }` where each run's x is the previous run's x + width (per-face measure); `boxes` = `[region]` plus `frame`-derived box when moved. `placeEdit` dispatches: `edit.kind === "line"` → `placeRuns`, else the existing block layout.
- `EditOverlay`: for line edits, paint covers from `boxes` in `background`, then one absolutely positioned span per run at its x and the baseline, font from `FONT_CSS`, colour per run. `usePdfMeasure` loads every face used by any run.
- `pageOps.ts` export: embed one standard font per face used by any run; `drawEdits` draws each run with `page.drawText(toWinAnsi(run.text), { x, y: baseline, size, font, color })`. Flatten path unchanged (covers painted, old Contents dropped, invisible layer from edited items).
- `text.ts` `applyEdits`: for line edits, remove items `coveredBy` the edit's `boxes` (existing rule) and append one `TextItemBox` per run (`fontName = run.font`, `fontSize`, `x`, `y = baseline`, width from the face's measure). Search re-index, `editsStamp`, Ask scope, and the Deep OCR gate therefore work unchanged.
- `EditHandles`: unchanged API; for a line edit the frame is `frame ?? region`; moving sets `frame` and `placeRuns` offsets every run by the frame delta; width drag is kept for parity but line edits do not wrap, so it only affects the cover box.
- OCR pages: OCR items carry one synthetic font, so a line is one Helvetica run; everything else is identical.

## Error handling

| Case | Behaviour |
| --- | --- |
| Box contains no text lines | Hint "No text here to edit"; nothing opens. |
| Page rotated from its original orientation | Existing "Rotate the page back…" message. |
| Run font cannot be matched | `matchFont` fallback (Helvetica family by flags), as today. |
| Field emptied | Line edit with `runs: []`: cover only (deletes the line). |
| Text wider than the drawn box | `overflow` style + "Text wider than the box"; applies anyway. |
| Two line edits overlap | Later edit's cover paints over the earlier; both reopen by click (topmost first). |
| Store update throws | Editor closes, error logged, nothing applied. |
| Legacy block edit present | Renders/exports/reopens via the existing block path; mixing on one page is fine. |

## Testing

- Units: `linesFrom` column split at 1.2 em and run merging; `linesInBox`/`lineAt`; `runStyle` matching; `placeRuns` x offsets and cover boxes with and without `frame`; `applyEdits` run-aware extraction (items replaced per run, fonts carried); `coverBoxes` unchanged for legacy.
- Component (jsdom): `LineEditor` renders one field per line with styled spans; typing inside a bold span keeps bold; Backspace across a boundary leaves the caret run; emptying a field yields `runs: []`; overflow note; Enter applies only changed lines; Escape applies nothing. `DragBox` click-vs-drag threshold.
- Export: a saved PDF with a bold-label line edit embeds two faces and draws both runs; the original string is absent from every stream (same check as `e2e/edit.spec.ts`).
- E2E: new fixture `columns.pdf` (two columns, bold labels + regular values, generated by `scripts/make-fixtures.ts`); drag a box over the left column, change one value, Done; assert the right column's text layer is unchanged, the download keeps a bold face for the label, and the changed value is present.

## Non-goals

Paragraph re-wrapping; changing a run's face from the editor (the existing font menu on handles stays for legacy block edits only); inserting new lines; editing inside rotated pages; migrating legacy block edits to runs.
