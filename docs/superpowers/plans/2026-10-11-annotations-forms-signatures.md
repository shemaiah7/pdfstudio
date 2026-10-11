# Annotations, Forms, Signatures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Markup tools (highlight, note, ink, rectangle, arrow, text box), form filling, and signatures in PDF Studio, exported by pdf-lib as editable annotations, real field values, and flattened signature images.

**Architecture:** Annotations and form values live in the document store next to edits and share its undo history. A per-page SVG `AnnotationOverlay` renders them with the same transform as `EditOverlay`; a `FormLayer` renders React inputs over field widgets. `src/pdf/annotations.ts` writes standard annotation dictionaries with appearance streams during `buildDocument`; `src/pdf/forms.ts` reads field definitions and rebuilds the AcroForm on export (method proven by the spike).

**Tech Stack:** React 19, Zustand, pdf-lib 1.17 (low-level `context.obj`/`context.stream`, form API), pdfjs-dist (node legacy build in tests for verification), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-annotations-forms-signatures-design.md`

## Global Constraints

- All annotation geometry is stored in unrotated PDF points relative to the page's crop box origin, exactly like edits; export adds the crop-box offset.
- History snapshots are `{ pages, edits, annotations, formValues }`; every create/move/resize/recolour/text change/delete is one undoable action; an ink stroke is one action.
- Export keeps annotations editable (real `/Highlight`, `/Text`+`/Popup`, `/Ink`, `/Square`, `/Line`, `/FreeText` with `/AP`); signatures are flattened as images; existing `/Annots` on copied pages are left untouched.
- Form values apply through pdf-lib's form API after rebuilding the AcroForm from copied widgets; `save({ updateFieldAppearances: true })`.
- Saved signature: localStorage key `pdfstudio.signature`, PNG data URL, every access in try/catch; never sent anywhere.
- Signature upload limit 2 MB, PNG or JPG only.
- Tool minimums: ink stroke ≥ 2 points after simplification (drop points < 1.5pt from the previous); shapes ≥ 4pt in at least one dimension; text box ≥ 40×16pt; empty text boxes discarded on blur.
- Signature placed at 30% of page width, aspect preserved.
- Degenerate annotations are skipped at export.
- Colour presets (RGB 0–1): black `[0,0,0]`, red `[0.86,0.15,0.15]`, blue `[0.15,0.39,0.92]`, green `[0.13,0.63,0.3]`, yellow `[1,0.84,0]`, purple `[0.55,0.25,0.8]`. Highlight default yellow; everything else default red. Stroke widths thin 1, medium 2.5, thick 5.

## Review Focus

1. A page with source `/Rotate 90` plus user rotation 270 (effective 0): pointer-to-PDF conversion and the overlay must agree, so a rectangle drawn around a word lands on that word in the export. (Test in Task 2: `pointerToPdf` round-trips through `overlayTransform` at every rotation.)
2. A note whose comment contains parentheses, backslashes, or non-Latin text: the exported `/Contents` must survive PDF string escaping and show correctly in pdf.js. (Test in Task 3.)
3. A form whose radio group has an option value different from its label, and a checkbox whose on-value is not `/Yes`: the chosen value must round-trip. (Test in Task 4.)
4. Undo after placing a signature then deleting its page: undo restores the page and its signature together. (Test in Task 1.)
5. Extracting only page 2 of a form where a field has widgets on pages 1 and 2: the output keeps that field with one widget and no dangling references, so Preview does not warn. (Test in Task 4.)

---

### Task 1: Annotation and form-value model in the store

**Files:**
- Modify: `src/pdf/types.ts`, `src/store/document.ts`, `src/store/document.test.ts`

**Interfaces:**
- Produces (`src/pdf/types.ts`):
  ```ts
  export type RGB = [number, number, number];
  export interface AnnotationBase { id: string; pageEntryId: string; color: RGB }
  export interface HighlightAnn extends AnnotationBase { kind: "highlight"; boxes: Box[] }
  export interface NoteAnn extends AnnotationBase { kind: "note"; x: number; y: number; text: string }
  export interface InkAnn extends AnnotationBase { kind: "ink"; strokes: { x: number; y: number }[][]; width: number }
  export interface ShapeAnn extends AnnotationBase { kind: "shape"; shape: "rect" | "arrow"; x1: number; y1: number; x2: number; y2: number; width: number }
  export interface FreeTextAnn extends AnnotationBase { kind: "freetext"; box: Box; text: string; fontSize: number }
  export interface SignatureAnn extends AnnotationBase { kind: "signature"; box: Box; png: string }
  export type Annotation = HighlightAnn | NoteAnn | InkAnn | ShapeAnn | FreeTextAnn | SignatureAnn;
  export type FormValue = string | boolean | string[];
  export type FormValues = Map<SourceId, Map<string, FormValue>>;
  ```
- Produces (store): `annotations: Annotation[]`, `formValues: FormValues`, `Snapshot = { pages, edits, annotations, formValues }`, actions `addAnnotation(a: Omit<Annotation, "id">): string`, `updateAnnotation(id, patch: Partial<Annotation>)`, `removeAnnotation(id)`, `setFormValue(sourceId, field, value)`, `clearForm(sourceId)`, `selectedAnnotationId: string | null`, `selectAnnotation(id | null)`. `remove(ids)` drops annotations of removed pages. `openFiles` clears both; `isDirty` compares annotations (ids + JSON) and formValues.

- [ ] **Step 1: Failing tests** — append to `src/store/document.test.ts`:

```ts
describe("annotations", () => {
  beforeEach(async () => { await s().openFiles([three()]); });
  const note = (pageEntryId: string) => ({ kind: "note" as const, pageEntryId, x: 10, y: 20, text: "hi", color: [0, 0, 0] as [number, number, number] });

  it("add, update, remove with undo/redo", () => {
    const id = s().addAnnotation(note(s().pages[0].id));
    expect(s().annotations[0]).toMatchObject({ id, kind: "note", text: "hi" });
    s().updateAnnotation(id, { text: "changed" });
    expect(s().annotations[0]).toMatchObject({ text: "changed" });
    s().undo();
    expect(s().annotations[0]).toMatchObject({ text: "hi" });
    s().redo();
    s().removeAnnotation(id);
    expect(s().annotations).toEqual([]);
    s().undo();
    expect(s().annotations.length).toBe(1);
    expect(s().isDirty()).toBe(true);
  });

  it("deleting a page drops its annotations and one undo restores both", () => {
    const [a, b] = s().pages.map((p) => p.id);
    s().addAnnotation({ kind: "signature", pageEntryId: a, box: { x: 0, y: 0, width: 50, height: 20 }, png: "data:image/png;base64,AA==", color: [0, 0, 0] });
    s().addAnnotation(note(b));
    s().remove([a]);
    expect(s().annotations.map((x) => x.kind)).toEqual(["note"]);
    s().undo();
    expect(s().pages.length).toBe(3);
    expect(s().annotations.map((x) => x.kind).sort()).toEqual(["note", "signature"]);
  });

  it("survives reorder and rotate; openFiles clears", async () => {
    const a = s().pages[0].id;
    s().addAnnotation(note(a));
    s().rotate([a], 90); s().reorder([a], 3);
    expect(s().annotations.length).toBe(1);
    await s().openFiles([two()]);
    expect(s().annotations).toEqual([]);
    expect(s().formValues.size).toBe(0);
  });

  it("selection of an annotation is not part of history", () => {
    const id = s().addAnnotation(note(s().pages[0].id));
    s().selectAnnotation(id);
    expect(s().selectedAnnotationId).toBe(id);
    s().removeAnnotation(id);
    expect(s().selectedAnnotationId).toBeNull();
  });
});

describe("form values", () => {
  beforeEach(async () => { await s().openFiles([three()]); });
  it("set, clear, undo, dirty", () => {
    const src = s().pages[0].sourceId;
    s().setFormValue(src, "name", "Alice");
    s().setFormValue(src, "agree", true);
    expect(s().formValues.get(src)?.get("name")).toBe("Alice");
    expect(s().isDirty()).toBe(true);
    s().undo();
    expect(s().formValues.get(src)?.get("agree")).toBeUndefined();
    s().redo();
    s().clearForm(src);
    expect(s().formValues.get(src)?.size ?? 0).toBe(0);
    s().undo();
    expect(s().formValues.get(src)?.get("name")).toBe("Alice");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/store/document.test.ts` → FAIL (`addAnnotation` is not a function).

- [ ] **Step 3: Implement**

Add the types above to `src/pdf/types.ts`.

In `src/store/document.ts`:
- `export interface Snapshot { pages: PageEntry[]; edits: Edit[]; annotations: Annotation[]; formValues: FormValues }`.
- State adds `annotations: Annotation[]`, `formValues: FormValues`, `savedAnnotations: Annotation[] | null`, `savedFormValues: FormValues | null`, `selectedAnnotationId: string | null`.
- `commit` becomes `commit(patch: Partial<Pick<Snapshot, "pages"|"edits"|"annotations"|"formValues">>)` that merges with the current values and pushes the full previous snapshot: 
  ```ts
  const snap = (s: DocumentState): Snapshot => ({ pages: s.pages, edits: s.edits, annotations: s.annotations, formValues: s.formValues });
  const commit = (patch: Partial<Snapshot>) => set((s) => ({ ...snap(s), ...patch, past: [...s.past, snap(s)], future: [] }));
  ```
  Update every existing caller (`addFiles`, `reorder`, `rotate`, `remove`, `addEdit`, `removeEdit`) to the object form; `undo`/`redo` restore all four fields.
- `remove(ids)`: also `annotations: annotations.filter(a => !gone.has(a.pageEntryId))`, and clear `selectedAnnotationId` if it was removed.
- `addAnnotation(a)`: `const id = nextId("an"); commit({ annotations: [...get().annotations, { ...a, id } as Annotation] }); return id;`
- `updateAnnotation(id, patch)`: `commit({ annotations: get().annotations.map(a => a.id === id ? { ...a, ...patch } as Annotation : a) })`.
- `removeAnnotation(id)`: commit filtered; `set({ selectedAnnotationId: null })` if it matched.
- `setFormValue(sourceId, field, value)`: clone outer and inner maps, set, commit `{ formValues }`.
- `clearForm(sourceId)`: clone, delete sourceId, commit.
- `selectAnnotation(id)`: plain `set`.
- `openFiles`: `initial()` includes empty annotations/formValues/selection; set `savedAnnotations: []`, `savedFormValues: new Map()`.
- `markClean` saves all four; `isDirty` adds `JSON.stringify(annotations) !== JSON.stringify(savedAnnotations)` and a `sameFormValues` comparison (serialize maps to sorted arrays).
- `reset()` resets everything.

- [ ] **Step 4: Run** — `npx vitest run src/store/document.test.ts` → all PASS. Then `npm test` and `npm run build` (other callers compile).
- [ ] **Step 5: Commit** — `git commit -m "feat: annotation and form-value model with undo"`

---

### Task 2: Geometry helpers

**Files:**
- Create: `src/pdf/geometry.ts`, `src/pdf/geometry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PageMeta { widthPt: number; heightPt: number; scale: number; rotation: 0|90|180|270 }  // rotation = effective
  export function localToPdf(lx: number, ly: number, m: PageMeta): { x: number; y: number }   // CSS px inside the (rotated) page box → unrotated PDF points
  export function pdfToLocal(x: number, y: number, m: PageMeta): { lx: number; ly: number }
  export function pointerToPdf(e: { clientX: number; clientY: number }, pageEl: HTMLElement, m: PageMeta): { x: number; y: number }
  export function simplifyStroke(pts: { x: number; y: number }[], minDist?: number): { x: number; y: number }[]  // default 1.5
  export function normalizeBox(x1: number, y1: number, x2: number, y2: number): Box
  export function shapeTooSmall(x1, y1, x2, y2, min?: number): boolean  // default 4; true when both |dx| and |dy| < min
  ```

- [ ] **Step 1: Failing tests** — `src/pdf/geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { localToPdf, pdfToLocal, simplifyStroke, normalizeBox, shapeTooSmall } from "./geometry";

const m = (rotation: 0 | 90 | 180 | 270) => ({ widthPt: 300, heightPt: 400, scale: 2, rotation });

describe("local <-> pdf", () => {
  it("rotation 0: origin bottom-left, y flipped", () => {
    expect(localToPdf(20, 760, m(0))).toEqual({ x: 10, y: 20 });
    expect(pdfToLocal(10, 20, m(0))).toEqual({ lx: 20, ly: 760 });
  });
  it("round-trips at every rotation", () => {
    for (const r of [0, 90, 180, 270] as const) {
      const p = pdfToLocal(37, 123, m(r));
      const back = localToPdf(p.lx, p.ly, m(r));
      expect(back.x).toBeCloseTo(37); expect(back.y).toBeCloseTo(123);
    }
  });
  it("rotation 90 maps the unrotated top-left to the rotated top-right", () => {
    // unrotated top-left = PDF (0, 400); rotated page box is 800x600 px; pdf.js rotates clockwise
    expect(pdfToLocal(0, 400, m(90))).toEqual({ lx: 800, ly: 0 });
    expect(pdfToLocal(0, 0, m(90))).toEqual({ lx: 0, ly: 0 });
  });
});

describe("simplifyStroke", () => {
  it("drops points closer than minDist and keeps the last point", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 2, y: 0 }, { x: 2.5, y: 0.2 }, { x: 9, y: 9 }];
    expect(simplifyStroke(pts)).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 9, y: 9 }]);
  });
});

describe("shapes", () => {
  it("normalizes and detects tiny shapes", () => {
    expect(normalizeBox(10, 30, 4, 2)).toEqual({ x: 4, y: 2, width: 6, height: 28 });
    expect(shapeTooSmall(0, 0, 3, 3)).toBe(true);
    expect(shapeTooSmall(0, 0, 3, 50)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.
- [ ] **Step 3: Implement** `src/pdf/geometry.ts`:

```ts
import type { Box } from "./types";
export interface PageMeta { widthPt: number; heightPt: number; scale: number; rotation: 0 | 90 | 180 | 270 }

// Inverse of overlayTransform: rotated-box px -> unrotated-box px.
function unrotate(lx: number, ly: number, m: PageMeta) {
  const W = m.widthPt * m.scale, H = m.heightPt * m.scale;
  switch (m.rotation) {
    case 90: return { x: ly, y: H - lx };
    case 180: return { x: W - lx, y: H - ly };
    case 270: return { x: W - ly, y: lx };
    default: return { x: lx, y: ly };
  }
}
function rotate(x: number, y: number, m: PageMeta) {
  const W = m.widthPt * m.scale, H = m.heightPt * m.scale;
  switch (m.rotation) {
    case 90: return { lx: H - y, ly: x };
    case 180: return { lx: W - x, ly: H - y };
    case 270: return { lx: y, ly: W - x };
    default: return { lx: x, ly: y };
  }
}
export function localToPdf(lx: number, ly: number, m: PageMeta) {
  const u = unrotate(lx, ly, m);
  return { x: u.x / m.scale, y: m.heightPt - u.y / m.scale };
}
export function pdfToLocal(x: number, y: number, m: PageMeta) {
  return rotate(x * m.scale, (m.heightPt - y) * m.scale, m);
}
export function pointerToPdf(e: { clientX: number; clientY: number }, pageEl: HTMLElement, m: PageMeta) {
  const r = pageEl.getBoundingClientRect();
  return localToPdf(e.clientX - r.left, e.clientY - r.top, m);
}
export function simplifyStroke(pts: { x: number; y: number }[], minDist = 1.5) {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  const last = pts[pts.length - 1];
  if (last && out[out.length - 1] !== last && out.length > 1) out[out.length - 1] = last;
  return out;
}
export function normalizeBox(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
export function shapeTooSmall(x1: number, y1: number, x2: number, y2: number, min = 4) {
  return Math.abs(x2 - x1) < min && Math.abs(y2 - y1) < min;
}
```

Note on `simplifyStroke`: the test expects `[0,0],[2,0],[9,9]`; `(2.5,0.2)` is dropped (distance 0.54 from (2,0)) and the last point `(9,9)` is kept because it is ≥ 1.5 away. The "replace last with the real last point" rule only matters when the final point was dropped; keep the implementation as written and confirm the test passes; if it fails because the last point replaced `(2,0)`, change the rule to: append the last point if it was dropped and is more than 0.01 from the current last.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "feat: page geometry helpers for annotation tools"`

---

### Task 3: Annotation export (pdf-lib) with appearance streams

**Files:**
- Create: `src/pdf/annotations.ts`, `src/pdf/annotations.test.ts`
- Modify: `src/pdf/pageOps.ts` (signature + call), `src/components/Toolbar.tsx` (pass annotations), `src/test/loadFixture.ts` (no change unless needed)

**Interfaces:**
- Produces `src/pdf/annotations.ts`:
  ```ts
  export async function writeAnnotations(out: PDFDocument, page: PDFPage, annotations: Annotation[], offset: { x: number; y: number }, fonts: { helv: PDFFont }): Promise<void>
  export function pdfString(s: string): PDFHexString   // UTF-16BE hex string for Contents
  export function isDegenerate(a: Annotation): boolean
  ```
- `buildDocument(sources, pages, edits = [], annotations = [])`.
- Test helpers already in `pageOps.test.ts` for decoding content streams may be reused; this task's tests use pdf-lib dictionaries and pdf.js `getAnnotations`.

- [ ] **Step 1: Failing tests** — `src/pdf/annotations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildDocument } from "./pageOps";
import { isDegenerate } from "./annotations";
import type { Annotation, SourceFile } from "./types";
import { loadFixture } from "../test/loadFixture";

const sources = new Map<string, SourceFile>([["a", { id: "a", name: "three.pdf", bytes: loadFixture("three"), pageCount: 3 }]]);
const page = { id: "p1", sourceId: "a", sourcePageIndex: 0, rotation: 0 as const };
const base = { pageEntryId: "p1", color: [1, 0, 0] as [number, number, number] };

async function annotsOf(bytes: Uint8Array, pageIdx = 0) {
  const doc = await PDFDocument.load(bytes);
  const arr = doc.getPage(pageIdx).node.Annots()!;
  return arr.asArray().map((r) => doc.context.lookup(r) as PDFDict).map((d) => ({ d, doc }));
}
const name = (d: PDFDict, k: string) => (d.get(PDFName.of(k)) as PDFName | undefined)?.decodeText?.() ?? String(d.get(PDFName.of(k)));
async function pdfjsAnnots(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  return (await pdf.getPage(1)).getAnnotations({ intent: "display" });
}

describe("writeAnnotations", () => {
  it("highlight has QuadPoints, colour, and an appearance stream with multiply blend", async () => {
    const a: Annotation = { id: "h", kind: "highlight", ...base, color: [1, 0.84, 0], boxes: [{ x: 20, y: 350, width: 100, height: 24 }] };
    const out = await buildDocument(sources, [page], [], [a]);
    const [{ d, doc }] = await annotsOf(out);
    expect(name(d, "Subtype")).toBe("/Highlight");
    const qp = (d.get(PDFName.of("QuadPoints")) as PDFArray).asArray().map(Number);
    expect(qp).toEqual([20, 374, 120, 374, 20, 350, 120, 350]);
    const ap = doc.context.lookup((d.get(PDFName.of("AP")) as PDFDict).get(PDFName.of("N"))) as PDFStream;
    expect(ap).toBeTruthy();
    const js = await pdfjsAnnots(out);
    expect(js[0]).toMatchObject({ subtype: "Highlight", hasAppearance: true });
  });

  it("note has popup with escaped and non-Latin contents", async () => {
    const text = "Check (this) \\ value — 日本語";
    const a: Annotation = { id: "n", kind: "note", ...base, x: 30, y: 300, text };
    const out = await buildDocument(sources, [page], [], [a]);
    const anns = await annotsOf(out);
    expect(anns.map((x) => name(x.d, "Subtype")).sort()).toEqual(["/Popup", "/Text"]);
    const js = await pdfjsAnnots(out);
    const t = js.find((x: any) => x.subtype === "Text");
    expect(t.contentsObj.str).toBe(text);
    expect(t.hasPopup).toBe(true);
  });

  it("ink has InkList and width", async () => {
    const a: Annotation = { id: "i", kind: "ink", ...base, width: 2.5, strokes: [[{ x: 10, y: 10 }, { x: 50, y: 60 }, { x: 90, y: 10 }]] };
    const out = await buildDocument(sources, [page], [], [a]);
    const [{ d }] = await annotsOf(out);
    expect(name(d, "Subtype")).toBe("/Ink");
    const ink = (d.get(PDFName.of("InkList")) as PDFArray).asArray()[0] as PDFArray;
    expect(ink.asArray().map(Number)).toEqual([10, 10, 50, 60, 90, 10]);
  });

  it("rect and arrow become Square and Line with OpenArrow", async () => {
    const r: Annotation = { id: "r", kind: "shape", ...base, shape: "rect", x1: 10, y1: 10, x2: 110, y2: 60, width: 1 };
    const l: Annotation = { id: "l", kind: "shape", ...base, shape: "arrow", x1: 10, y1: 100, x2: 110, y2: 160, width: 2.5 };
    const out = await buildDocument(sources, [page], [], [r, l]);
    const anns = await annotsOf(out);
    expect(anns.map((x) => name(x.d, "Subtype"))).toEqual(["/Square", "/Line"]);
    const le = (anns[1].d.get(PDFName.of("LE")) as PDFArray).asArray().map((n) => String(n));
    expect(le).toEqual(["/None", "/OpenArrow"]);
  });

  it("free text has DA and Contents and pdf.js renders it", async () => {
    const a: Annotation = { id: "f", kind: "freetext", ...base, box: { x: 20, y: 200, width: 150, height: 40 }, text: "Hello box", fontSize: 12 };
    const out = await buildDocument(sources, [page], [], [a]);
    const js = await pdfjsAnnots(out);
    expect(js[0]).toMatchObject({ subtype: "FreeText", hasAppearance: true });
    expect(js[0].contentsObj.str).toBe("Hello box");
  });

  it("signature is flattened as an image and creates no annotation", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const a: Annotation = { id: "s", kind: "signature", ...base, box: { x: 20, y: 50, width: 90, height: 30 }, png };
    const out = await buildDocument(sources, [page], [], [a]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).node.Annots()?.asArray().length ?? 0).toBe(0);
    const xobjs = doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject")) as PDFDict | undefined;
    expect(xobjs && xobjs.keys().length).toBeGreaterThan(0);
  });

  it("skips degenerate annotations", async () => {
    expect(isDegenerate({ id: "x", kind: "ink", ...base, width: 1, strokes: [[{ x: 1, y: 1 }]] })).toBe(true);
    expect(isDegenerate({ id: "y", kind: "shape", ...base, shape: "rect", x1: 5, y1: 5, x2: 5, y2: 5, width: 1 })).toBe(true);
    const out = await buildDocument(sources, [page], [], [{ id: "x", kind: "ink", ...base, width: 1, strokes: [[{ x: 1, y: 1 }]] }]);
    expect((await PDFDocument.load(out)).getPage(0).node.Annots()?.asArray().length ?? 0).toBe(0);
  });

  it("applies the crop box offset", async () => {
    const off = new Map<string, SourceFile>([["o", { id: "o", name: "offset.pdf", bytes: loadFixture("offset"), pageCount: 1 }]]);
    const a: Annotation = { id: "r", kind: "shape", pageEntryId: "p", color: [0, 0, 0], shape: "rect", x1: 10, y1: 10, x2: 60, y2: 40, width: 1 };
    const out = await buildDocument(off, [{ id: "p", sourceId: "o", sourcePageIndex: 0, rotation: 0 }], [], [a]);
    const [{ d }] = await annotsOf(out);
    expect((d.get(PDFName.of("Rect")) as PDFArray).asArray().map(Number)).toEqual([60, 110, 110, 140]);
  });
});
```

pdf.js in node: if `getDocument` complains about a missing worker, add `GlobalWorkerOptions.workerSrc` pointing at `pdfjs-dist/legacy/build/pdf.worker.mjs` or pass `{ data, useWorkerFetch: false, isEvalSupported: false }`; the Task-3 spike ran this exact import in tsx without extra config.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pdf/annotations.test.ts` → FAIL (module not found / `buildDocument` ignores 4th arg).

- [ ] **Step 3: Implement** `src/pdf/annotations.ts`:

```ts
import { PDFDocument, PDFPage, PDFName, PDFHexString, PDFFont, PDFRef } from "pdf-lib";
import type { Annotation, Box, RGB } from "./types";
import { layoutInBoxes } from "./layout";
import { toWinAnsi } from "./winansi";

export function pdfString(s: string): PDFHexString { return PDFHexString.fromText(s); }

export function isDegenerate(a: Annotation): boolean {
  switch (a.kind) {
    case "highlight": return a.boxes.length === 0 || a.boxes.every((b) => b.width <= 0 || b.height <= 0);
    case "ink": return a.strokes.every((s) => s.length < 2);
    case "shape": return Math.abs(a.x2 - a.x1) < 0.01 && Math.abs(a.y2 - a.y1) < 0.01;
    case "freetext": return a.box.width <= 0 || a.box.height <= 0 || a.text.trim() === "";
    case "signature": return a.box.width <= 0 || a.box.height <= 0 || !a.png.startsWith("data:image/");
    case "note": return false;
  }
}

const f = (n: number) => Number(n.toFixed(3));
const rgbOps = (c: RGB, op: "RG" | "rg") => `${f(c[0])} ${f(c[1])} ${f(c[2])} ${op}`;

function appearance(out: PDFDocument, bbox: [number, number, number, number], content: string, resources: Record<string, unknown> = {}): PDFRef {
  const stream = out.context.stream(content, { Type: "XObject", Subtype: "Form", FormType: 1, BBox: bbox, Resources: resources });
  return out.context.register(stream);
}

function addAnnot(out: PDFDocument, page: PDFPage, dict: Record<string, unknown>): PDFRef {
  const ref = out.context.register(out.context.obj({ Type: "Annot", F: 4, ...dict }));
  page.node.addAnnot(ref);
  return ref;
}

export async function writeAnnotations(out: PDFDocument, page: PDFPage, annotations: Annotation[], offset: { x: number; y: number }, fonts: { helv: PDFFont }) {
  const ox = offset.x, oy = offset.y;
  for (const a of annotations) {
    if (isDegenerate(a)) continue;
    switch (a.kind) {
      case "highlight": {
        const quads: number[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let content = "/GS gs " + rgbOps(a.color, "rg") + " ";
        for (const b of a.boxes) {
          const x1 = b.x + ox, y1 = b.y + oy, x2 = x1 + b.width, y2 = y1 + b.height;
          quads.push(x1, y2, x2, y2, x1, y1, x2, y1);
          minX = Math.min(minX, x1); minY = Math.min(minY, y1); maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
          content += `${f(x1)} ${f(y1)} ${f(b.width)} ${f(b.height)} re f `;
        }
        const gs = out.context.register(out.context.obj({ Type: "ExtGState", BM: "Multiply", CA: 1, ca: 1 }));
        const ap = appearance(out, [minX, minY, maxX, maxY], content, { ExtGState: { GS: gs } });
        addAnnot(out, page, { Subtype: "Highlight", Rect: [minX, minY, maxX, maxY], QuadPoints: quads, C: a.color, CA: 1, AP: { N: ap } });
        break;
      }
      case "note": {
        const x = a.x + ox, y = a.y + oy, s = 20;
        const content = `${rgbOps(a.color, "rg")} ${f(x)} ${f(y)} ${s} ${s} re f 1 1 1 rg ${f(x + 4)} ${f(y + 6)} ${s - 8} 3 re f ${f(x + 4)} ${f(y + 11)} ${s - 8} 3 re f`;
        const ap = appearance(out, [x, y, x + s, y + s], content);
        const textRef = out.context.nextRef();
        const popupRef = out.context.register(out.context.obj({ Type: "Annot", Subtype: "Popup", Rect: [x + s, y - 60, x + s + 180, y + s], Parent: textRef, Open: false }));
        out.context.assign(textRef, out.context.obj({ Type: "Annot", Subtype: "Text", F: 4, Rect: [x, y, x + s, y + s], Name: "Comment", Contents: pdfString(a.text), C: a.color, Popup: popupRef, AP: { N: ap } }));
        page.node.addAnnot(textRef);
        page.node.addAnnot(popupRef);
        break;
      }
      case "ink": {
        const inkList = a.strokes.filter((s) => s.length >= 2).map((s) => s.flatMap((p) => [f(p.x + ox), f(p.y + oy)]));
        const xs = inkList.flatMap((l) => l.filter((_, i) => i % 2 === 0)), ys = inkList.flatMap((l) => l.filter((_, i) => i % 2 === 1));
        const pad = a.width;
        const rect: [number, number, number, number] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
        let content = `${rgbOps(a.color, "RG")} ${f(a.width)} w 1 J 1 j `;
        for (const l of inkList) { content += `${l[0]} ${l[1]} m `; for (let i = 2; i < l.length; i += 2) content += `${l[i]} ${l[i + 1]} l `; content += "S "; }
        const ap = appearance(out, rect, content);
        addAnnot(out, page, { Subtype: "Ink", Rect: rect, InkList: inkList, C: a.color, BS: { W: a.width }, AP: { N: ap } });
        break;
      }
      case "shape": {
        const x1 = a.x1 + ox, y1 = a.y1 + oy, x2 = a.x2 + ox, y2 = a.y2 + oy, w = a.width, pad = w * 4 + 2;
        const rect: [number, number, number, number] = [Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad];
        if (a.shape === "rect") {
          const content = `${rgbOps(a.color, "RG")} ${f(w)} w ${f(Math.min(x1, x2))} ${f(Math.min(y1, y2))} ${f(Math.abs(x2 - x1))} ${f(Math.abs(y2 - y1))} re S`;
          addAnnot(out, page, { Subtype: "Square", Rect: rect, C: a.color, BS: { W: w }, AP: { N: appearance(out, rect, content) } });
        } else {
          const ang = Math.atan2(y2 - y1, x2 - x1), hl = 6 + w * 2;
          const hx1 = x2 - hl * Math.cos(ang - Math.PI / 6), hy1 = y2 - hl * Math.sin(ang - Math.PI / 6);
          const hx2 = x2 - hl * Math.cos(ang + Math.PI / 6), hy2 = y2 - hl * Math.sin(ang + Math.PI / 6);
          const content = `${rgbOps(a.color, "RG")} ${f(w)} w 1 J 1 j ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S ${f(hx1)} ${f(hy1)} m ${f(x2)} ${f(y2)} l ${f(hx2)} ${f(hy2)} l S`;
          addAnnot(out, page, { Subtype: "Line", Rect: rect, L: [x1, y1, x2, y2], LE: ["None", "OpenArrow"], C: a.color, BS: { W: w }, AP: { N: appearance(out, rect, content) } });
        }
        break;
      }
      case "freetext": {
        const b = a.box, x = b.x + ox, y = b.y + oy;
        const measure = (t: string, s: number) => fonts.helv.widthOfTextAtSize(toWinAnsi(t), s);
        const { lines, fontSize } = layoutInBoxes(a.text, [{ x: x + 2, y, width: b.width - 4, height: b.height }], a.fontSize, measure, { keepOverflow: true });
        let content = `/Tx BMC q ${f(x)} ${f(y)} ${f(b.width)} ${f(b.height)} re W n BT /Helv ${f(fontSize)} Tf ${rgbOps(a.color, "rg")} `;
        for (const l of lines) content += `1 0 0 1 ${f(l.x)} ${f(l.baseline)} Tm (${escapeLiteral(toWinAnsi(l.text))}) Tj `;
        content += "ET Q EMC";
        const ap = appearance(out, [x, y, x + b.width, y + b.height], content, { Font: { Helv: fonts.helv.ref } });
        addAnnot(out, page, { Subtype: "FreeText", Rect: [x, y, x + b.width, y + b.height], Contents: pdfString(a.text), DA: `/Helv ${f(a.fontSize)} Tf ${rgbOps(a.color, "rg")}`, C: [1, 1, 1], AP: { N: ap } });
        break;
      }
      case "signature": {
        const bytes = Uint8Array.from(atob(a.png.split(",")[1]), (c) => c.charCodeAt(0));
        const img = a.png.startsWith("data:image/jpeg") || a.png.startsWith("data:image/jpg") ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        page.drawImage(img, { x: a.box.x + ox, y: a.box.y + oy, width: a.box.width, height: a.box.height });
        break;
      }
    }
  }
}

function escapeLiteral(s: string) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
```

`atob` exists in Node 16+; fine for tests. pdf-lib `context.obj` maps JS arrays/objects/strings to PDF objects; strings like `"Highlight"` become names in dictionary values — verify: `context.obj({ Subtype: "Highlight" })` produces `/Subtype /Highlight` (pdf-lib treats string values as names). `Contents` must be a `PDFHexString` (done). `LE: ["None","OpenArrow"]` yields an array of names.

In `src/pdf/pageOps.ts`: add the `annotations: Annotation[] = []` parameter; embed Helvetica once per document lazily (`helv ??= await out.embedFont(StandardFonts.Helvetica)`); after the edits block call `await writeAnnotations(out, copied, annotations.filter(a => a.pageEntryId === entry.id), { x: ox, y: oy }, { helv })` (compute the crop box offset once per page, before edits, and reuse). The FreeText `DA` references `/Helv`, so also ensure a catalog `AcroForm` with `DR { Font { Helv } }` exists when any freetext was written: `ensureAcroFormDR(out, helv)` — add a small helper in `annotations.ts`:

```ts
export function ensureAcroFormDR(out: PDFDocument, helv: PDFFont) {
  const existing = out.catalog.get(PDFName.of("AcroForm"));
  const acro = existing ? (out.context.lookup(existing) as PDFDict) : out.context.obj({ Fields: [] });
  const dr = (acro.get(PDFName.of("DR")) && out.context.lookup(acro.get(PDFName.of("DR"))!)) as PDFDict | undefined;
  const drDict = dr ?? out.context.obj({});
  const fontDict = (drDict.get(PDFName.of("Font")) && out.context.lookup(drDict.get(PDFName.of("Font"))!)) as PDFDict | undefined ?? out.context.obj({});
  fontDict.set(PDFName.of("Helv"), helv.ref);
  drDict.set(PDFName.of("Font"), fontDict);
  acro.set(PDFName.of("DR"), drDict);
  if (!existing) out.catalog.set(PDFName.of("AcroForm"), out.context.register(acro));
}
```
Call it at the end of `buildDocument` if any freetext annotation was written. (Task 4 rebuilds the AcroForm for forms; make Task 4's rebuild preserve an existing `DR` Helv entry by merging rather than replacing.)

Update `src/components/Toolbar.tsx` to pass `s.annotations.filter(a => ids.has(a.pageEntryId))` as the 4th argument.

- [ ] **Step 4: Run** — `npx vitest run src/pdf/annotations.test.ts src/pdf/pageOps.test.ts` → PASS; `npm run build`.
- [ ] **Step 5: Commit** — `git commit -m "feat: export annotations as editable PDF annotations with appearance streams"`

---

### Task 4: Form fields: read, fill on export, fixture

**Files:**
- Create: `src/pdf/forms.ts`, `src/pdf/forms.test.ts`
- Modify: `scripts/make-fixtures.ts` (add `form.pdf`), `src/test/loadFixture.ts` (`"form"`), `src/pdf/pageOps.ts` (apply values), `src/components/Toolbar.tsx` (pass formValues)

**Interfaces:**
- Produces `src/pdf/forms.ts`:
  ```ts
  export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "unsupported";
  export interface FieldDef { name: string; type: FieldType; options?: string[]; onValue?: string; widgets: { pageIndex: number; rect: Box }[] }
  export async function readFields(source: SourceFile): Promise<FieldDef[]>      // cached per source id; cache cleared via sourceReleasers
  export function fieldsOnPage(fields: FieldDef[], pageIndex: number): FieldDef[]
  export function rebuildAcroForm(out: PDFDocument, src: PDFDocument, copiedPages: PDFPage[]): { fieldCount: number }
  export function applyFormValues(out: PDFDocument, values: Map<string, FormValue>, fields: FieldDef[]): void
  ```
- `buildDocument(sources, pages, edits, annotations, formValues: FormValues = new Map())`.

- [ ] **Step 1: Fixture** — in `scripts/make-fixtures.ts` add:

```ts
async function makeForm() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([300, 400]); const p2 = doc.addPage([300, 400]);
  p1.drawText("form:0", { x: 20, y: 360, size: 24, font }); p2.drawText("form:1", { x: 20, y: 360, size: 24, font });
  const form = doc.getForm();
  const name = form.createTextField("name"); name.addToPage(p1, { x: 20, y: 300, width: 200, height: 24 });
  const agree = form.createCheckBox("agree"); agree.addToPage(p1, { x: 20, y: 250, width: 20, height: 20 });
  const size = form.createRadioGroup("size"); size.addOptionToPage("S", p1, { x: 20, y: 200, width: 18, height: 18 }); size.addOptionToPage("L", p1, { x: 60, y: 200, width: 18, height: 18 });
  const color = form.createDropdown("color"); color.addOptions(["red", "blue"]); color.addToPage(p1, { x: 20, y: 150, width: 120, height: 24 });
  const notes = form.createTextField("notes"); notes.addToPage(p1, { x: 20, y: 100, width: 200, height: 24 }); notes.addToPage(p2, { x: 20, y: 300, width: 200, height: 24 });
  // unsupported: a signature field dict
  const sigRef = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFHexString.fromText("sig"), Rect: [20, 40, 200, 80], F: 4, P: p2.ref }));
  p2.node.addAnnot(sigRef);
  (doc.context.lookup(doc.catalog.get(PDFName.of("AcroForm"))!) as PDFDict).lookup(PDFName.of("Fields"), PDFArray).push(sigRef);
  writeFileSync(join(outDir, "form.pdf"), await doc.save());
}
await makeForm();
```
(import `PDFHexString, PDFName, PDFDict, PDFArray` from pdf-lib). Run `npm run fixtures`; add `"form"` to `FixtureName`.

- [ ] **Step 2: Failing tests** — `src/pdf/forms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFields, fieldsOnPage } from "./forms";
import { buildDocument } from "./pageOps";
import type { SourceFile } from "./types";
import { loadFixture } from "../test/loadFixture";

const src = (): SourceFile => ({ id: "f", name: "form.pdf", bytes: loadFixture("form"), pageCount: 2 });
const pages = [{ id: "p0", sourceId: "f", sourcePageIndex: 0, rotation: 0 as const }, { id: "p1", sourceId: "f", sourcePageIndex: 1, rotation: 0 as const }];
const values = (m: Record<string, string | boolean | string[]>) => new Map([["f", new Map(Object.entries(m))]]);

describe("readFields", () => {
  it("reads names, types, options, widgets per page", async () => {
    const fields = await readFields(src());
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.name).toMatchObject({ type: "text", widgets: [{ pageIndex: 0, rect: { x: 20, y: 300, width: 200, height: 24 } }] });
    expect(byName.agree.type).toBe("checkbox");
    expect(byName.size).toMatchObject({ type: "radio", options: ["S", "L"] });
    expect(byName.color).toMatchObject({ type: "dropdown", options: ["red", "blue"] });
    expect(byName.notes.widgets.map((w) => w.pageIndex)).toEqual([0, 1]);
    expect(byName.sig.type).toBe("unsupported");
    expect(fieldsOnPage(fields, 1).map((f) => f.name).sort()).toEqual(["notes", "sig"]);
  });
});

describe("form export", () => {
  it("round-trips values through a copied page, including radio export values and checkbox on-value", async () => {
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], values({ name: "Alice", agree: true, size: "L", color: "blue", notes: "n" }));
    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    expect(form.getTextField("name").getText()).toBe("Alice");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("size").getSelected()).toBe("L");
    expect(form.getDropdown("color").getSelected()).toEqual(["blue"]);
    const pdf = await getDocument({ data: out.slice() }).promise;
    const anns = await (await pdf.getPage(1)).getAnnotations({ intent: "display" });
    expect(anns.find((a: any) => a.fieldName === "name")).toMatchObject({ fieldValue: "Alice", hasAppearance: true });
  });

  it("extracting only page 2 keeps just the fields with widgets there", async () => {
    const out = await buildDocument(new Map([["f", src()]]), [pages[1]], [], [], values({ notes: "only", name: "ignored" }));
    const doc = await PDFDocument.load(out);
    const names = doc.getForm().getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(["notes", "sig"]);
    expect(doc.getForm().getTextField("notes").getText()).toBe("only");
    expect(doc.getForm().getTextField("notes").acroField.getWidgets().length).toBe(1);
  });

  it("export without values leaves fields intact and unsupported fields untouched", async () => {
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], new Map());
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getFields().length).toBe(6);
  });
});
```

- [ ] **Step 3: Run to verify failure** — module not found.

- [ ] **Step 4: Implement** `src/pdf/forms.ts`:

```ts
import { PDFDocument, PDFPage, PDFName, PDFDict, PDFArray, PDFRef, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from "pdf-lib";
import type { Box, FormValue, SourceFile, SourceId } from "./types";
import { sourceReleasers } from "../store/document";

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "unsupported";
export interface FieldDef { name: string; type: FieldType; options?: string[]; onValue?: string; widgets: { pageIndex: number; rect: Box }[] }

const cache = new Map<SourceId, Promise<FieldDef[]>>();
sourceReleasers.push((id) => cache.delete(id));

export async function readFields(source: SourceFile): Promise<FieldDef[]> {
  let p = cache.get(source.id);
  if (!p) {
    p = (async () => {
      const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
      const pages = doc.getPages();
      const pageOfRef = (ref: PDFRef) => pages.findIndex((pg) => pg.node.Annots()?.asArray().some((r) => r === ref || (r instanceof PDFRef && r.toString() === ref.toString())));
      let form; try { form = doc.getForm(); } catch { return []; }
      return form.getFields().map((field): FieldDef => {
        const widgets = field.acroField.getWidgets().map((w, i) => {
          const r = w.getRectangle();
          const ref = field.acroField.dict.context.getObjectRef(w.dict) ?? field.ref;
          const pageIndex = Math.max(0, pageOfRef(ref as PDFRef));
          return { pageIndex, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
        });
        if (field instanceof PDFTextField) return { name: field.getName(), type: "text", widgets };
        if (field instanceof PDFCheckBox) return { name: field.getName(), type: "checkbox", widgets };
        if (field instanceof PDFRadioGroup) return { name: field.getName(), type: "radio", options: field.getOptions(), widgets };
        if (field instanceof PDFDropdown || field instanceof PDFOptionList) return { name: field.getName(), type: "dropdown", options: field.getOptions(), widgets };
        return { name: field.getName(), type: "unsupported", widgets };
      });
    })();
    cache.set(source.id, p);
  }
  return p;
}

export function fieldsOnPage(fields: FieldDef[], pageIndex: number) {
  return fields.filter((f) => f.widgets.some((w) => w.pageIndex === pageIndex));
}

/** Rebuild /AcroForm in `out` from the widgets present on the copied pages (spike-proven). Merges with an existing AcroForm's DR. */
export function rebuildAcroForm(out: PDFDocument, src: PDFDocument, copiedPages: PDFPage[]) {
  const fieldRefs: PDFRef[] = [];
  const seen = new Set<string>();
  for (const page of copiedPages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      if (!(ref instanceof PDFRef)) continue;
      let top: PDFRef = ref; let dict = out.context.lookup(ref) as PDFDict;
      while (dict?.get(PDFName.of("Parent")) instanceof PDFRef) { top = dict.get(PDFName.of("Parent")) as PDFRef; dict = out.context.lookup(top) as PDFDict; }
      if (dict?.has(PDFName.of("FT")) && !seen.has(top.toString())) { seen.add(top.toString()); fieldRefs.push(top); }
    }
  }
  // prune Kids that were not copied (widgets on pages we did not keep)
  const copiedWidgetRefs = new Set(copiedPages.flatMap((p) => p.node.Annots()?.asArray().map(String) ?? []));
  for (const top of fieldRefs) {
    const dict = out.context.lookup(top) as PDFDict;
    const kids = dict.get(PDFName.of("Kids"));
    if (kids instanceof PDFArray) {
      const kept = kids.asArray().filter((k) => copiedWidgetRefs.has(String(k)));
      dict.set(PDFName.of("Kids"), out.context.obj(kept));
    }
  }
  const existingRef = out.catalog.get(PDFName.of("AcroForm"));
  const acro = existingRef ? (out.context.lookup(existingRef) as PDFDict) : out.context.obj({});
  acro.set(PDFName.of("Fields"), out.context.obj(fieldRefs));
  const srcAcro = src.catalog.get(PDFName.of("AcroForm")) ? (src.context.lookup(src.catalog.get(PDFName.of("AcroForm"))!) as PDFDict) : undefined;
  if (srcAcro?.get(PDFName.of("DA")) && !acro.get(PDFName.of("DA"))) acro.set(PDFName.of("DA"), srcAcro.get(PDFName.of("DA"))!);
  if (srcAcro?.get(PDFName.of("DR"))) {
    const srcDR = src.context.lookup(srcAcro.get(PDFName.of("DR"))!) as PDFDict;
    const cloned = srcDR.clone(out.context);
    const existingDR = acro.get(PDFName.of("DR")) ? (out.context.lookup(acro.get(PDFName.of("DR"))!) as PDFDict) : undefined;
    if (existingDR) { for (const [k, v] of cloned.entries()) if (!existingDR.has(k)) existingDR.set(k, v); }
    else acro.set(PDFName.of("DR"), out.context.register(cloned));
  }
  if (!existingRef) out.catalog.set(PDFName.of("AcroForm"), out.context.register(acro));
  return { fieldCount: fieldRefs.length };
}

export function applyFormValues(out: PDFDocument, values: Map<string, FormValue>, fields: FieldDef[]) {
  const form = out.getForm();
  const present = new Set(form.getFields().map((f) => f.getName()));
  for (const def of fields) {
    if (!present.has(def.name) || !values.has(def.name)) continue;
    const v = values.get(def.name)!;
    try {
      switch (def.type) {
        case "text": form.getTextField(def.name).setText(String(v)); break;
        case "checkbox": v ? form.getCheckBox(def.name).check() : form.getCheckBox(def.name).uncheck(); break;
        case "radio": if (typeof v === "string" && def.options?.includes(v)) form.getRadioGroup(def.name).select(v); break;
        case "dropdown": { const sel = Array.isArray(v) ? v : [String(v)]; if (sel.every((s) => def.options?.includes(s))) form.getDropdown(def.name).select(sel[0]); break; }
      }
    } catch { /* unsupported or malformed field: leave untouched */ }
  }
}
```

In `buildDocument`: track `copiedBySource: Map<SourceId, PDFPage[]>`; after the page loop, for each source with entries in `formValues` **or** with any fields at all (so unsupported/unfilled fields keep working), `rebuildAcroForm(out, loadedDoc, copiedPages)` then `applyFormValues(out, formValues.get(id) ?? new Map(), await readFields(source))`; wrap in try/catch and collect `formErrors: string[]` (source names) — expose by making `buildDocument` return `Uint8Array` as before but attach warnings via a second exported function? Keep the signature simple: `buildDocument` returns bytes; add an optional `onWarning?: (msg: string) => void` 6th parameter the Toolbar passes to show a banner "Form values for <name> could not be saved". Save with `out.save({ updateFieldAppearances: true })`. Run `readFields` here through pdf-lib on the already-loaded doc to avoid a second load: refactor `readFields` into `readFieldsFromDoc(doc)` (exported) and have `readFields(source)` call it; `buildDocument` uses `readFieldsFromDoc(loaded.get(sourceId))`.

Note on `pageOfRef`: pdf-lib widgets may be the field dict itself (single-widget fields have no Kids). Determine each widget's page by scanning page Annots for a ref whose looked-up dict `=== w.dict`; implement as: build once `const annotPage = new Map<PDFDict, number>()` from all pages' Annots (lookup each ref), then `annotPage.get(w.dict) ?? 0`. Replace the `getObjectRef` approach with this map (simpler and reliable).

Toolbar: pass `s.formValues` (full download) or the same map (extract; `rebuildAcroForm` prunes by copied widgets) as the 5th argument and `(msg) => s.setError(msg)` as the 6th.

- [ ] **Step 5: Run** — `npx vitest run src/pdf/forms.test.ts src/pdf/annotations.test.ts src/pdf/pageOps.test.ts` → PASS; `npm test`; `npm run build`.
- [ ] **Step 6: Commit** — `git commit -m "feat: read form fields and fill them on export"`

---

### Task 5: Tools store and tool palette

**Files:**
- Create: `src/store/tools.ts`, `src/store/tools.test.ts`, `src/components/ToolPalette.tsx`, `src/components/ToolPalette.test.tsx`
- Modify: `src/App.tsx` (render palette, Escape key), `src/styles.css`

**Interfaces:**
- Produces `src/store/tools.ts`:
  ```ts
  export type Tool = "select" | "highlight" | "note" | "ink" | "rect" | "arrow" | "freetext" | "sign";
  export const COLORS: { name: string; rgb: RGB }[]   // the six presets from Global Constraints
  export const WIDTHS: { name: "thin"|"medium"|"thick"; value: number }[]
  interface ToolsState { tool: Tool; color: RGB; width: number; pendingSignature: string | null; setTool(t: Tool): void; setColor(c: RGB): void; setWidth(w: number): void; setPendingSignature(png: string | null): void }
  export const useToolsStore
  ```
  Selecting the highlight tool switches colour to yellow if the current colour is the default red; selecting any other drawing tool from highlight switches back to red if the colour is yellow (so defaults feel right without fighting explicit choices).
- Palette test ids: `tool-<name>`, `color-<name>`, `width-<name>`.

- [ ] **Step 1: Failing tests** — `src/store/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useToolsStore, COLORS } from "./tools";
const s = () => useToolsStore.getState();
beforeEach(() => s().setTool("select"));
describe("tools store", () => {
  it("defaults", () => { expect(s().tool).toBe("select"); expect(s().color).toEqual(COLORS[1].rgb); expect(s().width).toBe(2.5); });
  it("highlight defaults to yellow and back", () => {
    s().setTool("highlight"); expect(s().color).toEqual(COLORS[4].rgb);
    s().setTool("ink"); expect(s().color).toEqual(COLORS[1].rgb);
  });
  it("keeps an explicit colour", () => {
    s().setColor(COLORS[2].rgb); s().setTool("highlight"); expect(s().color).toEqual(COLORS[2].rgb);
  });
});
```

`src/components/ToolPalette.test.tsx` (jsdom):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ToolPalette from "./ToolPalette";
import { useToolsStore } from "../store/tools";
afterEach(cleanup);
describe("ToolPalette", () => {
  it("activates tools and Escape returns to select", () => {
    render(<ToolPalette />);
    fireEvent.click(screen.getByTestId("tool-rect"));
    expect(useToolsStore.getState().tool).toBe("rect");
    expect(screen.getByTestId("tool-rect").className).toContain("active");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useToolsStore.getState().tool).toBe("select");
  });
  it("sets colour and width", () => {
    render(<ToolPalette />);
    fireEvent.click(screen.getByTestId("color-blue"));
    fireEvent.click(screen.getByTestId("width-thick"));
    expect(useToolsStore.getState().color).toEqual([0.15, 0.39, 0.92]);
    expect(useToolsStore.getState().width).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**

`src/store/tools.ts`:

```ts
import { create } from "zustand";
import type { RGB } from "../pdf/types";
export type Tool = "select" | "highlight" | "note" | "ink" | "rect" | "arrow" | "freetext" | "sign";
export const COLORS: { name: string; rgb: RGB }[] = [
  { name: "black", rgb: [0, 0, 0] }, { name: "red", rgb: [0.86, 0.15, 0.15] }, { name: "blue", rgb: [0.15, 0.39, 0.92] },
  { name: "green", rgb: [0.13, 0.63, 0.3] }, { name: "yellow", rgb: [1, 0.84, 0] }, { name: "purple", rgb: [0.55, 0.25, 0.8] },
];
export const WIDTHS = [{ name: "thin" as const, value: 1 }, { name: "medium" as const, value: 2.5 }, { name: "thick" as const, value: 5 }];
const same = (a: RGB, b: RGB) => a.every((v, i) => v === b[i]);
interface ToolsState { tool: Tool; color: RGB; width: number; pendingSignature: string | null; setTool(t: Tool): void; setColor(c: RGB): void; setWidth(w: number): void; setPendingSignature(png: string | null): void }
export const useToolsStore = create<ToolsState>((set, get) => ({
  tool: "select", color: COLORS[1].rgb, width: 2.5, pendingSignature: null,
  setTool: (tool) => {
    const { color } = get();
    let next = color;
    if (tool === "highlight" && same(color, COLORS[1].rgb)) next = COLORS[4].rgb;
    if (tool !== "highlight" && tool !== "select" && same(color, COLORS[4].rgb)) next = COLORS[1].rgb;
    set({ tool, color: next, pendingSignature: tool === "sign" ? get().pendingSignature : null });
  },
  setColor: (color) => set({ color }),
  setWidth: (width) => set({ width }),
  setPendingSignature: (pendingSignature) => set({ pendingSignature }),
}));
```

`src/components/ToolPalette.tsx`:

```tsx
import { useEffect } from "react";
import { useToolsStore, COLORS, WIDTHS, type Tool } from "../store/tools";
import { useDocumentStore } from "../store/document";

const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Select" }, { id: "highlight", label: "Highlight" }, { id: "note", label: "Note" }, { id: "ink", label: "Draw" },
  { id: "rect", label: "Rectangle" }, { id: "arrow", label: "Arrow" }, { id: "freetext", label: "Text box" }, { id: "sign", label: "Sign" },
];

export default function ToolPalette() {
  const { tool, color, width, setTool, setColor, setWidth } = useToolsStore();
  const selectedAnnotationId = useDocumentStore((s) => s.selectedAnnotationId);
  const updateAnnotation = useDocumentStore((s) => s.updateAnnotation);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setTool("select"); useDocumentStore.getState().selectAnnotation(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool]);
  const pickColor = (rgb: typeof color) => { setColor(rgb); if (selectedAnnotationId) updateAnnotation(selectedAnnotationId, { color: rgb }); };
  const pickWidth = (w: number) => { setWidth(w); if (selectedAnnotationId) updateAnnotation(selectedAnnotationId, { width: w } as never); };
  return (
    <div className="palette">
      {TOOLS.map((t) => <button key={t.id} data-testid={`tool-${t.id}`} className={tool === t.id ? "active" : ""} onClick={() => setTool(t.id)}>{t.label}</button>)}
      <span className="sep" />
      {COLORS.map((c) => <button key={c.name} data-testid={`color-${c.name}`} title={c.name} className={`swatch ${color === c.rgb || c.rgb.every((v, i) => v === color[i]) ? "active" : ""}`} style={{ background: `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(",")})` }} onClick={() => pickColor(c.rgb)} />)}
      <span className="sep" />
      {WIDTHS.map((w) => <button key={w.name} data-testid={`width-${w.name}`} className={width === w.value ? "active" : ""} onClick={() => pickWidth(w.value)}>{w.name}</button>)}
    </div>
  );
}
```

In `App.tsx` render `<ToolPalette />` directly under `<Toolbar …/>` (inside the non-empty branch). CSS:

```css
.palette { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.palette button { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; font-size: 13px; }
.palette button.active { background: var(--accent); color: white; border-color: transparent; }
.palette .swatch { width: 20px; height: 20px; padding: 0; border-radius: 50%; }
.palette .swatch.active { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 4: Run** — tests PASS, `npm run build`. **Step 5: Commit** — `git commit -m "feat: tool palette and tools store"`

---

### Task 6: AnnotationOverlay: render, select, move, resize, delete, note popover, free-text editing

**Files:**
- Create: `src/components/AnnotationOverlay.tsx`, `src/components/annotationHandles.ts`, `src/components/annotationHandles.test.ts`, `src/components/NotePopover.tsx`
- Modify: `src/components/PageView.tsx`, `src/App.tsx` (Delete key removes selected annotation when no text selection), `src/styles.css`

**Interfaces:**
- Produces `src/components/annotationHandles.ts` (pure):
  ```ts
  export function boundsOf(a: Annotation): Box                      // PDF points
  export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation
  export function resizeAnnotation(a: Annotation, handle: "nw"|"ne"|"sw"|"se", dx: number, dy: number, minSize?: number): Annotation  // boxes/shapes only; others returned unchanged
  ```
- `AnnotationOverlay` props: `{ pageEntryId: string; annotations: Annotation[]; meta: PageMeta; pageEl: () => HTMLElement | null }`. Renders inside the same rotated container as `EditOverlay` (reuse `overlayTransform`).

- [ ] **Step 1: Failing tests** — `src/components/annotationHandles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { boundsOf, moveAnnotation, resizeAnnotation } from "./annotationHandles";
import type { Annotation } from "../pdf/types";
const c: [number, number, number] = [0, 0, 0];
describe("handles", () => {
  it("bounds for each kind", () => {
    expect(boundsOf({ id: "1", kind: "shape", pageEntryId: "p", color: c, shape: "arrow", x1: 50, y1: 10, x2: 10, y2: 40, width: 1 })).toEqual({ x: 10, y: 10, width: 40, height: 30 });
    expect(boundsOf({ id: "2", kind: "ink", pageEntryId: "p", color: c, width: 2, strokes: [[{ x: 5, y: 5 }, { x: 15, y: 25 }]] })).toEqual({ x: 5, y: 5, width: 10, height: 20 });
    expect(boundsOf({ id: "3", kind: "note", pageEntryId: "p", color: c, x: 7, y: 8, text: "" })).toEqual({ x: 7, y: 8, width: 20, height: 20 });
  });
  it("moves every kind", () => {
    const ink = moveAnnotation({ id: "2", kind: "ink", pageEntryId: "p", color: c, width: 2, strokes: [[{ x: 5, y: 5 }]] }, 10, -3) as Extract<Annotation, { kind: "ink" }>;
    expect(ink.strokes[0][0]).toEqual({ x: 15, y: 2 });
    const hl = moveAnnotation({ id: "4", kind: "highlight", pageEntryId: "p", color: c, boxes: [{ x: 0, y: 0, width: 1, height: 1 }] }, 2, 2) as Extract<Annotation, { kind: "highlight" }>;
    expect(hl.boxes[0]).toMatchObject({ x: 2, y: 2 });
  });
  it("resizes boxes from the se handle with a minimum size", () => {
    const ft = resizeAnnotation({ id: "5", kind: "freetext", pageEntryId: "p", color: c, box: { x: 10, y: 10, width: 100, height: 40 }, text: "t", fontSize: 12 }, "se", 20, -10) as Extract<Annotation, { kind: "freetext" }>;
    expect(ft.box).toEqual({ x: 10, y: 0, width: 120, height: 50 });
    const tiny = resizeAnnotation(ft, "se", -500, 500) as Extract<Annotation, { kind: "freetext" }>;
    expect(tiny.box.width).toBe(8); expect(tiny.box.height).toBe(8);
  });
});
```

Note the `se` handle: in PDF space (y up) the south-east handle sits at `(x+width, y)`; dragging it by `(dx, dy)` sets `width += dx`, `y += dy`, `height -= dy`.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**

`src/components/annotationHandles.ts`:

```ts
import type { Annotation, Box } from "../pdf/types";
export function boundsOf(a: Annotation): Box {
  switch (a.kind) {
    case "highlight": { const xs = a.boxes.map((b) => b.x), ys = a.boxes.map((b) => b.y); const xe = a.boxes.map((b) => b.x + b.width), ye = a.boxes.map((b) => b.y + b.height); return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xe) - Math.min(...xs), height: Math.max(...ye) - Math.min(...ys) }; }
    case "note": return { x: a.x, y: a.y, width: 20, height: 20 };
    case "ink": { const pts = a.strokes.flat(); const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }; }
    case "shape": return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), width: Math.abs(a.x2 - a.x1), height: Math.abs(a.y2 - a.y1) };
    case "freetext": case "signature": return { ...a.box };
  }
}
export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case "highlight": return { ...a, boxes: a.boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })) };
    case "note": return { ...a, x: a.x + dx, y: a.y + dy };
    case "ink": return { ...a, strokes: a.strokes.map((s) => s.map((p) => ({ x: p.x + dx, y: p.y + dy }))) };
    case "shape": return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case "freetext": case "signature": return { ...a, box: { ...a.box, x: a.box.x + dx, y: a.box.y + dy } };
  }
}
function resizeBox(b: Box, h: "nw" | "ne" | "sw" | "se", dx: number, dy: number, min: number): Box {
  let { x, y, width, height } = b;
  if (h.includes("e")) width += dx; else { x += dx; width -= dx; }
  if (h.includes("n")) height += dy; else { y += dy; height -= dy; }
  if (width < min) { if (!h.includes("e")) x = b.x + b.width - min; width = min; }
  if (height < min) { if (!h.includes("n")) y = b.y + b.height - min; height = min; }
  return { x, y, width, height };
}
export function resizeAnnotation(a: Annotation, h: "nw" | "ne" | "sw" | "se", dx: number, dy: number, min = 8): Annotation {
  if (a.kind === "freetext" || a.kind === "signature") return { ...a, box: resizeBox(a.box, h, dx, dy, min) };
  if (a.kind === "shape") { const b = resizeBox(boundsOf(a), h, dx, dy, min); const flipX = a.x2 < a.x1, flipY = a.y2 < a.y1; return { ...a, x1: flipX ? b.x + b.width : b.x, x2: flipX ? b.x : b.x + b.width, y1: flipY ? b.y + b.height : b.y, y2: flipY ? b.y : b.y + b.height }; }
  return a;
}
```

`src/components/AnnotationOverlay.tsx` (SVG, in PDF-point user units via a `transform`): the SVG has `width=W height=H` px and a root `<g transform={`scale(${scale}) translate(0, ${heightPt}) scale(1,-1)`}>` so children are drawn directly in PDF points with y up (text and images inside need a local `scale(1,-1)` to un-flip; draw notes and signatures with their own flip). Elements:
- highlight: `<rect>` per box, `fill` from colour, `fill-opacity 0.4`, `style={{ mixBlendMode: "multiply" }}`
- ink: `<path d="M x y L …">` stroke colour, `strokeWidth`, round caps/joins, `fill none`
- shape rect: `<rect>`; arrow: `<line>` + `<polyline>` arrowhead computed as in export
- note: `<g transform={`translate(${x},${y})`}>` with a 20×20 rounded rect and two white bars
- signature: `<image href={png} x y width height transform="scale(1,-1)"` adjusted (`y → -(y+height)`)
- freetext: rendered as HTML (not SVG) in a sibling absolutely positioned layer: a `contenteditable` div at `pdfToLocal` position with `font-size: fontSize*scale px`; on `blur` → `updateAnnotation(id, { text })` or `removeAnnotation` when empty.
Selection: in Select mode, `onPointerDown` on an element selects it (`selectAnnotation(id)`), starts a drag (`setPointerCapture`), accumulates dx/dy in PDF points via `localToPdf` deltas, and on `pointerup` commits once with `updateAnnotation(id, moveAnnotation(a, dx, dy))` (during the drag, render a local transient copy so there is one undo step). Selected annotation gets a dashed bounds rect and four 8px handles for freetext/signature/shape; handle drags call `resizeAnnotation` the same way. Clicking a note opens `NotePopover` (absolutely positioned textarea + Done/Delete) which writes `updateAnnotation(id, { text })` on Done.

In `PageView.tsx`, render `<AnnotationOverlay pageEntryId={entry.id} annotations={annotations.filter(a => a.pageEntryId === entry.id)} meta={{ widthPt, heightPt, scale, rotation: effective }} pageEl={() => document.getElementById(`page-${entry.id}`)} />` after `EditOverlay`, only when metadata is known. The page `onClick` page-selection handler must ignore clicks that originated on the overlay (check `e.target.closest(".annotationOverlay")`).

`App.tsx` keydown: when `Delete`/`Backspace` and `selectedAnnotationId` is set and the active element is not an input/textarea/contenteditable, `removeAnnotation(selectedAnnotationId)` instead of removing pages.

CSS:

```css
.annotationOverlay { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.annotationOverlay svg { position: absolute; left: 0; top: 0; overflow: visible; }
.annotationOverlay .hit { cursor: move; }
.annotationOverlay .handle { fill: white; stroke: var(--accent); cursor: nwse-resize; }
.annotationOverlay .freetext { position: absolute; outline: 1px dashed transparent; white-space: pre-wrap; line-height: 1.2; font-family: Helvetica, Arial, sans-serif; padding: 2px; }
.annotationOverlay .freetext:focus, .annotationOverlay .freetext.selected { outline-color: var(--accent); }
.notePopover { position: absolute; z-index: 5; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px; width: 220px; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
.notePopover textarea { width: 100%; box-sizing: border-box; font: inherit; min-height: 70px; }
```

Pointer events: the overlay container is `pointer-events: none` in Select mode except on annotation elements (`pointer-events: auto`), so text selection and page clicks still work; drawing tools (Task 7) flip the container to `pointer-events: auto`.

- [ ] **Step 4: Run** — handles tests PASS; `npm test`; `npm run build`; `npm run e2e` (must still pass: the overlay must not intercept the Download click or thumbnail drag).
- [ ] **Step 5: Manual check** — `npm run dev`: with the store seeded through the UI from Task 7 not yet available, temporarily add a note via the browser console is not possible (isolated world); defer the visual check to Task 7's manual step and say so in the report.
- [ ] **Step 6: Commit** — `git commit -m "feat: annotation overlay with selection, move, resize, note popover"`

---

### Task 7: Tool interactions: highlight, note, draw, shapes, text box

**Files:**
- Create: `src/components/useDrawingTool.ts`, `src/components/useDrawingTool.test.ts`
- Modify: `src/components/AnnotationOverlay.tsx`, `src/App.tsx` (highlight-on-selection), `src/store/tools.ts` (message state)

**Interfaces:**
- Produces `src/components/useDrawingTool.ts`: a pure reducer `drawingReducer(state, event)` with events `{ type: "down", x, y } | { type: "move", x, y } | { type: "up" }` and tool/colour/width context, returning `{ state, commit?: Omit<Annotation,"id"> }` so it is unit-testable without a DOM; plus the hook `useDrawingTool(pageEntryId, meta, pageEl)` that wires pointer events to the reducer and calls `addAnnotation` on commit.
- Tools store gains `message: string | null` and `setMessage` for the "No selectable text on this page" notice shown in the palette.

- [ ] **Step 1: Failing tests** — `src/components/useDrawingTool.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drawingReducer, initialDrawing } from "./useDrawingTool";
const ctx = { pageEntryId: "p", color: [1, 0, 0] as [number, number, number], width: 2.5, fontSize: 12 };
describe("drawingReducer", () => {
  it("ink: collects simplified points and commits a stroke with >= 2 points", () => {
    let s = initialDrawing;
    s = drawingReducer(s, { type: "down", x: 0, y: 0 }, "ink", ctx).state;
    s = drawingReducer(s, { type: "move", x: 0.5, y: 0 }, "ink", ctx).state;
    s = drawingReducer(s, { type: "move", x: 10, y: 10 }, "ink", ctx).state;
    const r = drawingReducer(s, { type: "up" }, "ink", ctx);
    expect(r.commit).toMatchObject({ kind: "ink", strokes: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]], width: 2.5 });
  });
  it("ink: a tap commits nothing", () => {
    let s = drawingReducer(initialDrawing, { type: "down", x: 0, y: 0 }, "ink", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "ink", ctx).commit).toBeUndefined();
  });
  it("rect: discards tiny drags, commits otherwise", () => {
    let s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 10 }, "rect", ctx).state;
    s = drawingReducer(s, { type: "move", x: 12, y: 12 }, "rect", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "rect", ctx).commit).toBeUndefined();
    s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 10 }, "arrow", ctx).state;
    s = drawingReducer(s, { type: "move", x: 60, y: 40 }, "arrow", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "arrow", ctx).commit).toMatchObject({ kind: "shape", shape: "arrow", x1: 10, y1: 10, x2: 60, y2: 40 });
  });
  it("freetext: requires a 40x16 box and commits with empty text for editing", () => {
    let s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 100 }, "freetext", ctx).state;
    s = drawingReducer(s, { type: "move", x: 30, y: 90 }, "freetext", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "freetext", ctx).commit).toBeUndefined();
    s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 100 }, "freetext", ctx).state;
    s = drawingReducer(s, { type: "move", x: 100, y: 60 }, "freetext", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "freetext", ctx).commit).toMatchObject({ kind: "freetext", box: { x: 10, y: 60, width: 90, height: 40 }, text: "", fontSize: 12 });
  });
  it("note: commits on down", () => {
    expect(drawingReducer(initialDrawing, { type: "down", x: 5, y: 6 }, "note", ctx).commit).toMatchObject({ kind: "note", x: 5, y: 6, text: "" });
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**

`src/components/useDrawingTool.ts` (reducer part):

```ts
import { useCallback, useRef, useState } from "react";
import type { Annotation, RGB } from "../pdf/types";
import type { Tool } from "../store/tools";
import { simplifyStroke, normalizeBox, shapeTooSmall, pointerToPdf, type PageMeta } from "../pdf/geometry";
import { useDocumentStore } from "../store/document";

export interface DrawingState { active: boolean; start: { x: number; y: number } | null; current: { x: number; y: number } | null; points: { x: number; y: number }[] }
export const initialDrawing: DrawingState = { active: false, start: null, current: null, points: [] };
export type DrawEvent = { type: "down"; x: number; y: number } | { type: "move"; x: number; y: number } | { type: "up" };
export interface DrawCtx { pageEntryId: string; color: RGB; width: number; fontSize: number }

export function drawingReducer(s: DrawingState, e: DrawEvent, tool: Tool, ctx: DrawCtx): { state: DrawingState; commit?: Omit<Annotation, "id"> } {
  const base = { pageEntryId: ctx.pageEntryId, color: ctx.color };
  if (e.type === "down") {
    if (tool === "note") return { state: initialDrawing, commit: { kind: "note", ...base, x: e.x, y: e.y, text: "" } };
    return { state: { active: true, start: { x: e.x, y: e.y }, current: { x: e.x, y: e.y }, points: [{ x: e.x, y: e.y }] } };
  }
  if (!s.active || !s.start) return { state: s };
  if (e.type === "move") return { state: { ...s, current: { x: e.x, y: e.y }, points: tool === "ink" ? [...s.points, { x: e.x, y: e.y }] : s.points } };
  const st = s.start, cur = s.current ?? s.start;
  const done = { state: initialDrawing };
  switch (tool) {
    case "ink": { const pts = simplifyStroke(s.points); return pts.length < 2 ? done : { ...done, commit: { kind: "ink", ...base, strokes: [pts], width: ctx.width } }; }
    case "rect": case "arrow": return shapeTooSmall(st.x, st.y, cur.x, cur.y) ? done : { ...done, commit: { kind: "shape", ...base, shape: tool, x1: st.x, y1: st.y, x2: cur.x, y2: cur.y, width: ctx.width } };
    case "freetext": { const b = normalizeBox(st.x, st.y, cur.x, cur.y); return b.width < 40 || b.height < 16 ? done : { ...done, commit: { kind: "freetext", ...base, box: b, text: "", fontSize: ctx.fontSize } }; }
    default: return done;
  }
}

export function useDrawingTool(pageEntryId: string, meta: PageMeta, pageEl: () => HTMLElement | null, tool: Tool, ctx: Omit<DrawCtx, "pageEntryId">) {
  const [state, setState] = useState<DrawingState>(initialDrawing);
  const ref = useRef(state); ref.current = state;
  const addAnnotation = useDocumentStore((s) => s.addAnnotation);
  const selectAnnotation = useDocumentStore((s) => s.selectAnnotation);
  const dispatch = useCallback((e: DrawEvent) => {
    const r = drawingReducer(ref.current, e, tool, { pageEntryId, ...ctx });
    ref.current = r.state; setState(r.state);
    if (r.commit) { const id = addAnnotation(r.commit); if (r.commit.kind === "freetext" || r.commit.kind === "note") selectAnnotation(id); }
  }, [tool, pageEntryId, ctx, addAnnotation, selectAnnotation]);
  const toPdf = (ev: { clientX: number; clientY: number }) => { const el = pageEl(); return el ? pointerToPdf(ev, el, meta) : null; };
  const handlers = {
    onPointerDown: (ev: React.PointerEvent) => { const p = toPdf(ev); if (!p) return; (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); dispatch({ type: "down", ...p }); },
    onPointerMove: (ev: React.PointerEvent) => { if (!ref.current.active) return; const p = toPdf(ev); if (p) dispatch({ type: "move", ...p }); },
    onPointerUp: () => dispatch({ type: "up" }),
  };
  return { state, handlers };
}
```

In `AnnotationOverlay`: when `tool` is one of ink/rect/arrow/freetext/note, the container gets `pointer-events: auto` and the drawing handlers; render the in-progress preview from `state` (a path for ink, a rect/line for shapes, a dashed box for freetext). A freshly committed freetext (selected, empty) auto-focuses its contenteditable; blur with empty text removes it. A freshly committed note opens its popover.

Highlight tool: in `App.tsx`'s `selectionchange` handler, when `useToolsStore.getState().tool === "highlight"`, on `mouseup` (listen for `mouseup` on `document`), call `captureSelection()`; if it returns boxes, `addAnnotation({ kind: "highlight", pageEntryId, boxes, color })` and `window.getSelection()?.removeAllRanges()`; if the mouseup target is inside a `.page` whose text layer has no spans, `setMessage("No selectable text on this page")` (cleared on next tool change). The palette shows `message` next to the tools.

- [ ] **Step 4: Run** — reducer tests PASS; `npm test`; `npm run build`; `npm run e2e`.
- [ ] **Step 5: Manual check** — `npm run dev`, open `three.pdf`: Draw a stroke, draw a rectangle and an arrow, place a note and type, drag a text box and type "Hello", highlight "three:1" on page 2, select and move each, Undo several times, rotate page 1 and confirm the overlay rotates with it, Download, open the file in Preview: annotations present and editable.
- [ ] **Step 6: Commit** — `git commit -m "feat: highlight, note, draw, shape, and text box tools"`

---

### Task 8: Signature dialog and sign tool

**Files:**
- Create: `src/components/SignatureDialog.tsx`, `src/components/SignatureDialog.test.tsx`, `src/signature/storage.ts`, `src/signature/storage.test.ts`, `src/signature/image.ts`, `src/signature/image.test.ts`, `public/fonts/` (three script fonts: use open-licensed fonts "Dancing Script", "Great Vibes", "Pacifico" from Google Fonts as `.woff2`; download at build time is not allowed, so vendor the files into `public/fonts/` and declare `@font-face` in `styles.css`)
- Modify: `src/components/AnnotationOverlay.tsx` (sign placement), `src/components/ToolPalette.tsx` (opens dialog when the sign tool is chosen), `src/styles.css`

**Interfaces:**
- `src/signature/storage.ts`: `loadSignature(): string | null`, `saveSignature(png: string): boolean`, `forgetSignature(): void` (key `pdfstudio.signature`, try/catch, `canRemember(): boolean`).
- `src/signature/image.ts`: `whiteToTransparent(imageData: ImageData, threshold?: number): ImageData` (pixels with r,g,b all ≥ threshold (default 235) get alpha 0); `fitSignature(pngWidth, pngHeight, pageWidthPt): Box` (width = 0.3 × pageWidthPt, aspect preserved; position chosen by the click).
- `SignatureDialog` props `{ onConfirm(png: string): void; onClose(): void }`; tabs Draw / Type / Upload; "Remember this signature" checkbox (hidden when `canRemember()` is false); "Use saved" and "Forget" when a saved signature exists. Test ids: `sig-tab-draw`, `sig-tab-type`, `sig-tab-upload`, `sig-name`, `sig-font-<n>`, `sig-remember`, `sig-use-saved`, `sig-forget`, `sig-confirm`, `sig-error`.

- [ ] **Step 1: Failing tests**

`src/signature/storage.test.ts` (jsdom):

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSignature, saveSignature, forgetSignature } from "./storage";
beforeEach(() => localStorage.clear());
describe("signature storage", () => {
  it("round-trips and forgets", () => {
    expect(loadSignature()).toBeNull();
    expect(saveSignature("data:image/png;base64,AA==")).toBe(true);
    expect(loadSignature()).toBe("data:image/png;base64,AA==");
    forgetSignature();
    expect(loadSignature()).toBeNull();
  });
  it("ignores non-png values", () => { localStorage.setItem("pdfstudio.signature", "javascript:x"); expect(loadSignature()).toBeNull(); });
});
```

`src/signature/image.test.ts` (jsdom):

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { whiteToTransparent, fitSignature } from "./image";
describe("signature image", () => {
  it("makes near-white pixels transparent", () => {
    const d = new ImageData(new Uint8ClampedArray([255, 255, 255, 255, 240, 240, 240, 255, 10, 10, 10, 255]), 3, 1);
    const out = whiteToTransparent(d);
    expect(Array.from(out.data)).toEqual([255, 255, 255, 0, 240, 240, 240, 0, 10, 10, 10, 255]);
  });
  it("fits to 30% of page width", () => { expect(fitSignature(400, 100, 300)).toEqual({ x: 0, y: 0, width: 90, height: 22.5 }); });
});
```

`src/components/SignatureDialog.test.tsx` (jsdom): renders with a saved signature → "Use saved" calls `onConfirm` with it; "Forget" removes it; Type tab with name "Ada" and confirm calls `onConfirm` with a `data:image/png` string (mock `HTMLCanvasElement.prototype.getContext` to return a minimal 2D stub with `fillText`, `measureText → {width: 40}`, `clearRect`, `font`, and `toDataURL → "data:image/png;base64,AA=="`); Upload tab with a 3 MB file shows `sig-error`.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** storage, image helpers, and the dialog:
- Draw tab: a 400×150 canvas; pointer events draw black 2.5px round-capped lines; Clear button; confirm uses `canvas.toDataURL("image/png")` after trimming transparent margins (compute bounding box of alpha > 0 and crop via a second canvas).
- Type tab: input `sig-name`, three font buttons rendering the name at 48px into a 600×150 canvas with the chosen `@font-face` family (await `document.fonts.load(...)` first, wrapped in try/catch), then the same trim.
- Upload tab: `<input type=file accept="image/png,image/jpeg">`; reject > 2 MB or other types with `sig-error`; load into an Image, draw to canvas, `whiteToTransparent`, trim, PNG data URL.
- Remember checkbox saves on confirm; `sig-use-saved` confirms the stored PNG; `sig-forget` clears it.
- `ToolPalette`: choosing "sign" opens the dialog; `onConfirm` sets `setPendingSignature(png)` and keeps the tool as `sign`; `onClose` without confirm reverts to `select`.
- `AnnotationOverlay`: with tool `sign` and a `pendingSignature`, a click at `(x, y)` decodes the PNG size (`new Image()` + `onload`), computes `fitSignature(w, h, meta.widthPt)`, centres the box on the click, `addAnnotation({ kind: "signature", box, png, color: [0,0,0] })`, then `setTool("select")` and selects it.
- Vendor the three `.woff2` files; `@font-face` rules in `styles.css`; CSS for the dialog (`.sigDialog` modal, tabs, canvas border).

- [ ] **Step 4: Run** — `npm test`, `npm run build`. **Step 5: Manual** — draw a signature, remember it, place on two pages, reload the page: "Use saved" appears; Download and confirm the image appears in Preview. **Step 6: Commit** — `git commit -m "feat: signature dialog (draw, type, upload) with local remember"`

---

### Task 9: FormLayer and Clear form

**Files:**
- Create: `src/components/FormLayer.tsx`, `src/components/FormLayer.test.tsx`, `src/components/useFields.ts`
- Modify: `src/components/PageView.tsx`, `src/components/Toolbar.tsx` (Clear form button), `src/styles.css`

**Interfaces:**
- `useFields(source: SourceFile): FieldDef[] | null` (async load via `readFields`, cached per source id in a module map, triggers re-render when ready).
- `FormLayer` props `{ sourceId, sourcePageIndex, fields: FieldDef[], meta: PageMeta }`; renders inside the rotated overlay container; inputs carry `data-field="<name>"`.

- [ ] **Step 1: Failing test** — `src/components/FormLayer.test.tsx` (jsdom): render `FormLayer` with two fields (text "name" with a widget on page 0; checkbox "agree") and `meta = { widthPt: 300, heightPt: 400, scale: 1, rotation: 0 }`; typing "Bob" into `[data-field=name]` sets `useDocumentStore.getState().formValues.get("src")?.get("name") === "Bob"`; clicking the checkbox sets `agree === true`; the text input's style `left` equals `20px` and `top` equals `76px` for widget rect `{x:20,y:300,width:200,height:24}` (400 − 300 − 24 = 76); an `unsupported` field renders a `div[data-field]` with `title` "This field type isn't supported yet" and no input.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — `FormLayer` maps `fieldsOnPage(fields, sourcePageIndex)`; for each widget on this page computes `pdfToLocal(rect.x, rect.y + rect.height, meta)` for the top-left (in the unrotated container, so use scale only: `left = rect.x*scale`, `top = (heightPt - rect.y - rect.height)*scale`, width/height × scale) and renders: text → `<input type=text>`; checkbox → `<input type=checkbox>`; radio → `<input type=radio name=<field> value=<option>>` where each widget corresponds to `options[i]` by index; dropdown → `<select>` with options. Values come from `formValues`; changes call `setFormValue(sourceId, name, value)`. `stopPropagation` on pointer events so the page click handler and drawing tools don't fire. Toolbar: when the first page's source has any fields, show "Clear form" calling `clearForm(sourceId)`.
  `PageView` renders `<FormLayer>` (inside the same rotated container used by the annotation overlay, below it in DOM order) when `useFields(source)` returns fields for that source.

CSS: `.formLayer input, .formLayer select { position: absolute; box-sizing: border-box; font: 12px Helvetica, Arial, sans-serif; background: rgba(173, 216, 230, 0.35); border: 1px solid rgba(0,0,0,0.25); } .formLayer input[type=checkbox], .formLayer input[type=radio] { margin: 0; accent-color: var(--accent); }`

- [ ] **Step 4: Run** — `npm test`, `npm run build`. **Step 5: Manual** — open `src/test/fixtures/form.pdf`, fill every field, Download, open in Preview: values present, fields still editable; Clear form empties them. **Step 6: Commit** — `git commit -m "feat: form filling layer with clear form"`

---

### Task 10: End-to-end test and docs

**Files:**
- Create: `e2e/annotate.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Playwright test** `e2e/annotate.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName } from "pdf-lib";
import { readFileSync } from "node:fs";

test("draw, rectangle, fill a field, download", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', "src/test/fixtures/form.pdf");
  await page.waitForFunction(() => document.querySelectorAll(".page canvas[style*='height']").length >= 1);
  const pg = page.locator(".pageview .page").first();
  const box = (await pg.boundingBox())!;
  await page.getByTestId("tool-ink").click();
  await page.mouse.move(box.x + 50, box.y + 50); await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 }); await page.mouse.up();
  await page.getByTestId("tool-rect").click();
  await page.mouse.move(box.x + 150, box.y + 150); await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 220, { steps: 5 }); await page.mouse.up();
  await page.getByTestId("tool-select").click();
  await page.locator('[data-field="name"]').fill("Grace");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = readFileSync((await download.path())!);
  const doc = await PDFDocument.load(bytes);
  const subtypes = doc.getPage(0).node.Annots()!.asArray().map((r) => String((doc.context.lookup(r) as any).get(PDFName.of("Subtype"))));
  expect(subtypes).toContain("/Ink");
  expect(subtypes).toContain("/Square");
  expect(doc.getForm().getTextField("name").getText()).toBe("Grace");
});
```

- [ ] **Step 2: Run** — `npm run e2e` → 2 passed. If the ink stroke is not committed because pointer capture is not granted in headless mode, dispatch `pointerup` on the overlay via `page.mouse.up()` after a final small move; adjust and record.
- [ ] **Step 3: README** — add a "Markup and forms" paragraph listing the tools, the Remember-signature behaviour (local only), and that downloads keep annotations editable while signatures are flattened.
- [ ] **Step 4: Commit** — `git commit -m "test: e2e for markup and form filling; docs"`

---

## Self-review notes

- Spec coverage: model and undo (T1), geometry and rotation (T2), export of all six kinds with AP and crop-box offset (T3), forms read/rebuild/apply/subset/unsupported (T4), palette + colours/widths + Escape (T5), overlay rendering, select/move/resize/delete, note popover, free-text editing (T6), tool behaviours incl. minimums and highlight-from-selection message (T7), signature dialog three tabs, remember/forget, 30% placement (T8), FormLayer and Clear form (T9), Playwright and docs (T10). Error table: unsupported fields (T4/T9), upload limits (T8), AcroForm failure warning via `onWarning` (T4), degenerate skip (T3), no-text highlight message (T7), localStorage unavailable → `canRemember` (T8), export failure banner exists from sub-project 1.
- Review Focus: 1 → T2 round-trip test (plus manual rotation check in T7); 2 → T3 note test with parentheses/backslash/CJK; 3 → T4 radio "L" and checkbox round-trip (fixture checkbox on-value is pdf-lib's default `/Yes`; the test asserts through pdf-lib's own API so a non-Yes on-value would still pass through `check()`); 4 → T1 delete-page-then-undo test with a signature; 5 → T4 page-2 extract keeps `notes` with one widget.
- Type consistency: `Annotation` union, `RGB`, `FormValue`, `FormValues` in types.ts; `PageMeta` in geometry.ts; `buildDocument(sources, pages, edits, annotations, formValues, onWarning?)`; store actions named identically across tasks; test ids `tool-*`, `color-*`, `width-*`, `sig-*`, `data-field`.
