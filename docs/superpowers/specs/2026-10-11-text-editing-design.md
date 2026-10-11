# In-place text editing — design

Date: 2026-10-11. Sub-project 4 of PDF Studio (originally "overlay text editing").

## Goal

Let a clinician click any text on a page (typed PDF or OCR'd scan), change it in place, and have the result look native on screen and in the saved PDF, while Summarize, Ask, Extract, Search, and the saved text layer all see the edited text. Everything stays in the browser.

True content-stream editing remains out of scope: no JavaScript library can rewrite embedded font subsets. This is overlay editing done well: cover the original block, draw replacement text in a matched standard font.

## Decisions

| Question | Decision |
| --- | --- |
| Interaction | A new **Edit text** tool: click a line, the whole paragraph block opens as an editable box; text reflows inside it. |
| Font fidelity | Match the original font by name and flags to the 12 PDF standard faces (Helvetica, Times, Courier × regular/bold/oblique/bold-oblique). No font downloads; pdf-lib embeds them without files. |
| Colours | Sampled from the rendered page bitmap (background ring, darkest text cluster), so typed pages and scans behave the same. |
| Scans | Editing an OCR block also rewrites the OCR store words for that block, so search, AI, and the saved invisible text layer carry the change. |
| Rotation | Editing is available only when the page is shown unrotated (page `/Rotate` plus user rotation = 0), matching the current Rewrite insert rule. |
| Line geometry | A line's baseline is the min y of its items; paragraph join accepts a vertical gap >= 0. |
| Region and covers | `Edit.region` persists the original block box; cover boxes are the layout boxes plus the remainder box (`coverBoxes`). |
| Font change | Changing the font re-lays out the edit. |
| Library cache | Library records carry `editsStamp`; they are used as a cache only when it equals the session stamp, so edited text never survives a reload in the index. |
| Selecting edits | The first click on an existing edit selects it (handles); clicking its body reopens it. |
| Export of edited typed pages | Flattened: the original page is rasterized at 200 DPI (capped at 20 MP), edits are drawn on top, and an invisible text layer carries the remaining text, so covered text cannot be extracted. Scanned pages keep their OCR text layer. If flattening fails the page is saved unflattened with a warning. |
| Rejected | Re-embedding original fonts (subsets lack glyphs; CFF/Type1 cannot be re-embedded). Painting the block as an image (unsearchable). |

## Data model

`src/pdf/types.ts`:

```ts
export type EditFont =
  | "helvetica" | "helvetica-bold" | "helvetica-oblique" | "helvetica-boldoblique"
  | "times" | "times-bold" | "times-italic" | "times-bolditalic"
  | "courier" | "courier-bold" | "courier-oblique" | "courier-boldoblique";
export type LegacyEditFont = "sans" | "sans-bold" | "serif"; // aliases: sans→helvetica, sans-bold→helvetica-bold, serif→times
export interface Edit {
  id: string; pageEntryId: string;
  boxes: Box[];            // one per original line, crop-relative points (unchanged convention)
  text: string;            // lines joined by "\n"
  fontSize: number;
  font: EditFont;
  color: RGB;              // text colour
  background: RGB;         // cover colour
  lineHeight: number;      // baseline-to-baseline spacing in points
  source: "native" | "ocr";
  blockKey?: string;       // `${sourceId}:${pageIndex}:${lineIndexOfFirstLine}` so re-editing replaces rather than stacks
}
```

`normalizeFont(f: EditFont | LegacyEditFont): EditFont` is applied in `addEdit`, `updateEdit`, and export, so the AI Rewrite insert (which still passes `sans`/`sans-bold`/`serif`) keeps working unchanged. Edits are in-memory document state with undo/redo as today; no persistence.

`src/pdf/metrics.ts` and `src/pdf/pageOps.ts` map the 12 faces to `StandardFonts` (`Helvetica`, `HelveticaBold`, `HelveticaOblique`, `HelveticaBoldOblique`, `TimesRoman`, `TimesRomanBold`, `TimesRomanItalic`, `TimesRomanBoldItalic`, `Courier`, `CourierBold`, `CourierOblique`, `CourierBoldOblique`). `EditOverlay` maps them to CSS: `Helvetica, Arial, sans-serif` / `"Times New Roman", Times, serif` / `"Courier New", Courier, monospace` with weight 700 and `font-style: italic` as needed.

## Modules

### `src/edit/blocks.ts` (pure)

```ts
export interface TextLine { text: string; x: number; baseline: number; width: number; fontSize: number; fontName: string; items: TextItemBox[] }
export interface TextBlock { lines: TextLine[]; box: Box; lineHeight: number; fontSize: number; fontName: string; text: string; firstLineIndex: number }
export function linesFrom(items: TextItemBox[]): TextLine[]      // group by baseline (|Δy| ≤ 0.5·fontSize), sort x; a line's fontName is its first item's
export function blocksFrom(lines: TextLine[]): TextBlock[]        // consecutive lines join when |Δleft| ≤ 0.5·fontSize, 0 < gap ≤ 1.6·fontSize, same fontName, |ΔfontSize| ≤ 10 %
export function blockAt(blocks: TextBlock[], x: number, y: number): TextBlock | undefined  // point in block box (crop-relative points), 2 pt tolerance
```

`TextItemBox` gains `fontName: string` (pdf.js item `fontName`, or `"ocr"` for OCR items). For a single-line block `lineHeight` = 1.2 × fontSize. `box` is the union of line boxes; `firstLineIndex` is the index of the block's first line in the page's line list, used for `blockKey`.

### `src/edit/fontMatch.ts` (pure)

```ts
export interface FontInfo { name?: string; serif?: boolean; monospace?: boolean; bold?: boolean; italic?: boolean; cssFamily?: string; cssWeight?: number; cssStyle?: string }
export function matchFont(info: FontInfo): EditFont
```

Rules, in order: monospace flag or name/css matching `/courier|mono/i` → Courier family. Serif flag, or name/css matching `/times|georgia|garamond|book|roman|serif/i` and not `/sans/i` → Times family. Otherwise Helvetica. Bold when `bold`, `cssWeight ≥ 600`, or name matches `/bold|black|heavy|semibold/i`. Italic when `italic`, `cssStyle === "italic"`, or name matches `/italic|oblique/i`. OCR blocks (`fontName === "ocr"`) → `helvetica`.

`src/edit/fontInfo.ts` resolves a pdf.js `fontName` to `FontInfo`: after the page has rendered, `page.commonObjs.get(fontName)` gives `{ name, isSerifFont, isMonospace, bold, italic, black }`; if the object is not yet loaded, fall back to the text-layer style's `fontFamily` (`styles[fontName].fontFamily`) as `cssFamily`.

### `src/edit/colors.ts` (pure over ImageData)

```ts
export function sampleColors(image: ImageData, block: { x: number; y: number; width: number; height: number } /* pixels, top-left origin */, ring = 3): { background: RGB; text: RGB }
```

Background: most frequent colour (quantised to 16 levels per channel) in the ring outside the block; text: darkest 5 % of pixels inside the block, averaged. Failure (no pixels) → white/black. The caller renders the page at the current scale through the existing `PageCanvas` bitmap (`canvas.getContext("2d").getImageData`).

### `src/edit/layout.ts` (extends `src/pdf/layout.ts`)

`layoutBlock(text, box, fontSize, lineHeight, measure): { lines: PlacedLine[]; height: number; overflowLines: number }` wraps words at the block width using the pdf-lib measurer (`measureFor(font)`), breaking on explicit newlines, placing baselines at `top − ascent` then every `lineHeight`. `height` is the laid-out height; `overflowLines` = lines beyond the original box height. Boxes for an edit are regenerated from the laid-out lines (one box per line, block width), so covers always match the text.

### `src/store/document.ts`

- `addEdit` and new `updateEdit(id, patch)` normalise the font and replace an existing edit with the same `blockKey`.
- `edits` changes already snapshot for undo.

### `src/pdf/text.ts`

`extractPageText` gains an edits overlay: after native/OCR items are produced, items whose box centre lies inside any edit box of that page are removed, and each edit's laid-out lines are inserted as items (`fontName` = the edit font) so `linesFromItems` orders them in reading position. The page text cache key includes an `editsVersion` counter bumped on every edits change for that page. Search re-indexes the source when its edits change (same debounce hook as OCR, keyed on `editsVersion`).

### `src/store/ocr.ts` (scans)

`applyEditToOcr(sourceId, pageIndex, edit)`: replaces OCR words inside the edit's boxes with words from the edit's layout (one `OcrWord` per word, boxes from the measurer, confidence 1), bumps `at`, writes the store, invalidates the page text. Called on Apply and on edit deletion (restoring the original words is not possible, so deletion keeps the OCR text as last written; the cover is simply removed — documented behaviour).

### `src/pdf/pageOps.ts` (export)

Per edit: draw the cover rectangle in `background`, then each laid-out line in the matched standard font, `fontSize`, `color`. The OCR invisible layer keeps dropping words under edit boxes (safety net; the OCR store already holds the edited words).

## UI

- **Tool palette**: `Edit text` tool (`data-testid="tool-edit"`, key `E`).
- **Hover**: with the tool active, the block under the pointer gets an outline (`.block-hint`).
- **Block editor** (`src/components/BlockEditor.tsx`): a contentEditable div positioned over the block (overlay coordinates), `background` colour, matched font, `fontSize × scale`, `line-height: lineHeight × scale`, pre-filled with the block text, caret at the click. Enter applies, Shift+Enter inserts a newline, Escape cancels, click outside applies. Done and Cancel buttons in a small bar; a hint `Fits` / `Overflows by N line(s)`. The box grows downward with overflow.
- **Apply**: unchanged text → no edit. Otherwise `addEdit` with boxes from the layout, `blockKey`, colours, font, lineHeight, source. For OCR pages also `applyEditToOcr`.
- **Existing edits**: clickable with the tool to reopen; a handle bar with `Delete` and a font menu (12 faces, grouped by family) that calls `updateEdit`. Drag to move; drag the right edge to change width (re-layout).
- **Rotated pages**: tool message `Rotate the page back to its original orientation to edit text.`
- **No block under click**: tool message `No text here.`
- Text-layer spans intersecting an edit's boxes get `visibility: hidden`; `.edit-line` elements are selectable text (`user-select: text`) so Highlight and Rewrite work on edited text.

## Error handling

| Case | Behaviour |
| --- | --- |
| Font object not loaded yet | Use the text-layer CSS family heuristics; never block the editor. |
| Canvas/ImageData unavailable | White background, black text. |
| Block narrower than one character of the text | Editor does not open; message `Block too narrow to edit.` |
| Non-WinAnsi characters | Rendered as `?` in export (existing rule); the editor shows a hint `Some characters cannot be saved in this font` when present. |
| Edit applied on a page whose OCR is still running | Allowed on native text only; OCR blocks are not offered until the page is `done`. |
| Deleting an edit on a scan | Cover removed; OCR text stays as last written (noted in UI tooltip). |

## Testing

- Unit: `blocks.ts` grouping (baseline tolerance, paragraph split on gap/left edge/font change, OCR words form blocks, `blockAt`), `fontMatch.ts` table (names, flags, css fallbacks, legacy aliases), `colors.ts` on synthetic ImageData, `layoutBlock` wrap/newline/overflow, `extractPageText` edits overlay (covered items removed, edit lines inserted in order, cache invalidated on edits change), `applyEditToOcr` (words replaced within boxes only, `at` bumped), export draws cover + text with the right face/colour (parse back with pdf.js: text present at position; original absent for OCR pages).
- Component (jsdom): editor opens pre-filled at the clicked block; Enter applies, Escape cancels, unchanged text creates no edit; reopen replaces the edit (same blockKey); delete removes; font menu updates.
- E2E (Playwright): on `three.pdf`, Edit tool, click "three:0", type "three:9", Enter, download; saved PDF text contains "three:9" and not "three:0". On `scan.pdf` (gated with `E2E_OCR=1`), after "Text recognized", edit "hypertension" → "hypotension"; the text layer shows the new word and the downloaded PDF's text contains "hypotension" and not "hypertension".

## Non-goals

- Editing text inside form fields or annotations (those have their own editors).
- Matching embedded fonts exactly or re-embedding them.
- Editing on rotated views; images; tables as structures.
- Persisting edits across reloads.
