# PDF Studio: Annotations, Forms, Signatures (Sub-project 3)

Date: 2026-10-11
Status: Draft for review
Depends on: sub-projects 1 and 2 (merged to `main`, deployed).

## Goal

Let a visitor mark up a PDF (highlight, notes, freehand drawing, rectangles,
arrows, text boxes), fill its form fields or type onto a flat form, and place
a signature; then download a PDF in which the markup stays editable in Acrobat
and Preview, the filled fields are real field values, and signatures are
flattened into the page.

## Decisions already made

- Approach A: our own annotation model in the document store, rendered as a
  React overlay, written by pdf-lib on export as standard annotation objects
  with appearance streams. pdf.js's built-in editor is not used (it needs the
  whole viewer scaffolding and has no shape tools).
- Form filling covers existing AcroForm fields plus "add text anywhere",
  which is the free-text tool.
- Signatures: draw, type in a script font, or upload an image; optionally
  remembered in this browser only.
- Export keeps annotations editable; signatures are flattened.
- Spike (2026-10-11) confirmed pdf-lib can fill fields on a page copied into a
  new document once the AcroForm dictionary is rebuilt from the copied
  widgets; pdf.js then sees values and appearances. Export therefore keeps
  the existing copy-pages pipeline.
- Committed follow-up, not in this sub-project: reading and editing
  annotations that already exist in the source PDF. This sub-project must
  not make that harder: existing annotations are preserved untouched on
  export, and the annotation model's shapes are chosen to map one-to-one to
  the PDF subtypes so importing them later is a parser, not a redesign.

## Product direction note

The owner intends PDF Studio to serve healthcare professionals (clinical
documents, forms, signatures). This sub-project is general-purpose; the
clinical direction will be designed separately and may add templates,
field-level validation, and audit trails on top of the model defined here.

## Users and success criteria

- Highlight a sentence, add a note explaining it, draw an arrow to a figure,
  download, open in Preview: all three are visible and the note's comment
  opens on click.
- Fill a tax-style form (text, checkbox, radio, dropdown), download, reopen
  in PDF Studio and in Preview: values are present and the fields are still
  fields.
- Type onto a scanned, flat form using the text-box tool; the download shows
  the text where it was placed.
- Draw a signature once, tick "Remember", place it on two pages; next visit
  the saved signature is offered.
- Undo works across every one of those actions, and annotations follow their
  page through reorder and rotation.

## Data model (document store)

```ts
type AnnotationBase = { id: string; pageEntryId: string; color: [r,g,b] };
type Highlight = AnnotationBase & { kind: "highlight"; boxes: Box[] };          // one box per line, PDF points
type Note      = AnnotationBase & { kind: "note"; x: number; y: number; text: string };
type Ink       = AnnotationBase & { kind: "ink"; strokes: { x: number; y: number }[][]; width: number };
type Shape     = AnnotationBase & { kind: "shape"; shape: "rect" | "arrow"; x1: number; y1: number; x2: number; y2: number; width: number };
type FreeText  = AnnotationBase & { kind: "freetext"; box: Box; text: string; fontSize: number };
type Signature = AnnotationBase & { kind: "signature"; box: Box; png: string }; // data URL
type Annotation = Highlight | Note | Ink | Shape | FreeText | Signature;

formValues: Map<SourceId, Map<string, FormValue>>   // FormValue = string | boolean | string[]
```

- All geometry is in unrotated PDF points relative to the page's crop box
  origin, the same convention as edits.
- History snapshots become `{ pages, edits, annotations, formValues }`.
  Every annotation create, move, resize, recolour, text change, and delete
  is one undoable action; an ink stroke is one action.
- `remove(ids)` drops annotations whose `pageEntryId` is removed.
  `openFiles` clears everything; `addFiles` keeps existing state.
- `isDirty` covers annotations and form values.
- Field definitions per source are read once with pdf-lib and cached:
  `{ name, type: "text"|"checkbox"|"radio"|"dropdown"|"unsupported", options?, widgets: { pageIndex, rect }[] }`.

## UI

### Tool palette
A second toolbar row: Select, Highlight, Note, Draw, Rectangle, Arrow,
Text box, Sign; plus a colour swatch picker (six presets) and a stroke width
(thin/medium/thick) that apply to the active tool and to the selected
annotation. Escape returns to Select. The active tool is UI state in a small
`tools` store, not in the document store.

### AnnotationOverlay (per page, above text layer and edit overlay)
SVG layer using the same transform as `EditOverlay` (scale, crop box,
effective rotation). Renders:
- highlight: translucent rects, `mix-blend-mode: multiply`
- ink: `<path>` per stroke, round joins
- shape: `<rect>` or `<line>` with an arrowhead marker
- freetext: an absolutely positioned `contenteditable` div
- note: 20pt icon at the anchor; click opens a popover with a textarea
- signature: `<image>` in its box
Select mode: click selects; selected boxes and shapes get move and resize
handles; Delete/Backspace removes; the colour and width pickers update it.
Pointer events are converted to PDF points through the page metadata
(`widthPt`, `heightPt`, scale, effective rotation) in a pure helper
`pointerToPdf(clientX, clientY, pageEl)`.

### Tool behaviour
- Highlight: on mouse-up with a non-empty text selection on one page,
  create a highlight from the selection's line boxes; empty selection on a
  page with no text shows "No selectable text on this page".
- Note: click places a note and opens its popover for typing.
- Draw: pointer down/move/up builds a stroke; points closer than 1.5pt to
  the previous point are dropped; a stroke with fewer than 2 points is
  discarded.
- Rectangle, Arrow: drag; results smaller than 4pt in both dimensions are
  discarded.
- Text box: drag a box (minimum 40×16pt), then type; blur with empty text
  discards it.
- Sign: opens the signature dialog; after confirm the next click on a page
  places the signature at 30% of the page width (aspect preserved), then it
  behaves as a selectable box.

### Signature dialog
Tabs: Draw (canvas pad, clear button), Type (name in one of three script
fonts bundled as web fonts, rendered to canvas), Upload (PNG/JPG ≤ 2 MB,
near-white background made transparent). "Remember this signature" stores
the PNG data URL in localStorage under `pdfstudio.signature` (try/catch);
when present the dialog opens on "Use saved" with a "Forget" button.

### FormLayer (per form page, below the annotation overlay)
React inputs positioned at each widget rect: `<input type=text>`, checkbox,
radio group (one per field, options by export value), `<select>`. Changes
write `formValues` immediately. Unsupported field types render read-only
with a tooltip "This field type isn't supported yet". Toolbar gains "Clear
form" when the current document has fields.

## Export

`buildDocument(sources, pages, edits, annotations, formValues)`:

1. Copy page, apply edits (unchanged).
2. Annotations for the page, each as a pdf-lib low-level dict added to the
   page's `/Annots`, geometry offset by the crop box origin, with an
   appearance stream (`/AP /N`) drawn by a small `appearance.ts` module:
   - highlight → `/Highlight`, `QuadPoints`, `C`, AP with multiply blend
   - note → `/Text`, `Name /Comment`, `Contents`, `/Popup` child with
     `Parent` back-link, `Open false`
   - ink → `/Ink`, `InkList`, `BS` width, AP stroked paths
   - shape rect → `/Square`; arrow → `/Line` with `LE [/None /OpenArrow]`
   - freetext → `/FreeText`, `DA "/Helv <size> Tf <r> <g> <b> rg"`,
     `Contents`, AP with wrapped text (reuse `layoutInBoxes`)
   - signature → `drawImage` of the embedded PNG in its box (no annotation)
   Existing `/Annots` entries on the copied page are left as they are.
3. Form values: if the source has fields, rebuild the AcroForm dictionary
   from the copied widgets (top-level field refs, `DA`, cloned `DR`), set
   it on the catalog, apply values through pdf-lib's form API
   (`setText`, `check/uncheck`, `select`), and save with
   `updateFieldAppearances: true`. Extracting a page subset keeps only the
   fields whose widgets were copied.
4. Degenerate annotations (zero-area box, stroke with < 2 points) are
   skipped.

## Error handling

| Condition | Behavior |
|---|---|
| Unsupported field type | Read-only widget with tooltip; untouched on export |
| Signature upload > 2 MB or not an image | Inline dialog message |
| AcroForm rebuild throws for a source | Export succeeds without that source's values; banner "Form values for `<name>` could not be saved" |
| Highlight with no text selection | Tool message, nothing created |
| localStorage unavailable | "Remember" checkbox hidden |
| Export failure in annotation writing | Banner names the page; working state unchanged |

## Testing

- `annotations.export.test.ts` (node): one test per kind; load output with
  pdf-lib, assert subtype, rect, colour, kind-specific entries, AP present;
  pdf.js `getAnnotations` sees highlight, note (with popup contents),
  free text; signature image drawn (content stream has `Do`).
- `forms.test.ts`: fixture with text/checkbox/radio/dropdown; field read
  (names, types, rects, page indices); values round-trip; subset export keeps
  only on-page fields; unsupported type reported.
- Store tests: create/move/resize/recolour/delete/undo/redo per kind;
  dropped with page; survive reorder and rotate; formValues undo.
- Geometry tests: `pointerToPdf` at scale 1.2 and rotations 0/90/180/270;
  stroke simplification; shape minimum size.
- Component tests (jsdom): palette state and Escape; note popover edit;
  free text discard on empty; form input writes to store; signature dialog
  remember/forget.
- Playwright: draw an ink stroke and a rectangle, fill a text field on a
  form fixture, download, verify with pdf-lib.
- Manual: open the download in macOS Preview; highlights and notes editable,
  fields filled.

## Out of scope

Editing annotations already in the source PDF (committed follow-up),
stamps, redaction, certificate-based digital signatures, OCR, clinical
templates.
