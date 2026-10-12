# Line Editing with Styled Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic block editing with user-targeted line editing: drag a box (or click a line), get one field per line pre-styled with its real runs, and have only changed lines become edits that render, export, and extract per run.

**Architecture:** A new `kind: "line"` edit carries `runs` (text, face, size, colour) plus `x`/`baseline`/`region`. Detection splits lines at column gaps and merges items into runs. One shared `placePieces` function lays out any edit (legacy block or line) into drawable pieces, and the overlay, exporter, and text extraction all consume pieces, so per-run fonts flow everywhere with one code path. A `LineEditor` renders one contenteditable per line with styled spans; `PageView` gains drag-box targeting.

**Tech Stack:** React 19, Zustand 5, pdf-lib standard fonts, pdfjs-dist 6.4, Vitest 5 (jsdom for components), Playwright. `@napi-rs/canvas` + pdf-lib for the fixture.

**Spec:** `docs/superpowers/specs/2026-10-12-line-editing-design.md`

## Global Constraints

- Legacy block edits (no `kind`) keep rendering, exporting, reopening, and extracting exactly as today; every change to shared code must keep `src/edit/*.test.ts`, `src/pdf/*.test.ts`, `src/components/*.test.tsx`, and `e2e/edit.spec.ts` green.
- Column split threshold: gap > `1.2 * prev.fontSize`. Run merge: same `fontName` and `|fontSize diff| <= 2 %`. Box selection: vertical overlap >= half the line height AND horizontal overlap >= `0.5 * fontSize`. Click-vs-drag threshold: 3 px.
- Copy (verbatim): "No text here to edit", "Text wider than the box", "Rotate the page back to its original orientation to edit text." (existing).
- Test IDs: `line-editor` (wrapper), `line-field` (each field, with `data-line-index`), `line-overflow`, `line-done`, `line-cancel`, `drag-box`.
- Fonts: only the twelve `EditFont` faces; `toWinAnsi` before every pdf-lib measure/draw.
- All positions are crop-relative points (same convention as today). No new dependencies.
- `npx tsc -b` clean and `npx vitest run` green after every task; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never stage `.superpowers/`.

## Review Focus

1. **Two columns on one baseline** must become two lines and a box over the left column must select only it. Pinned in Task 1.
2. **A bold label with a regular value on one line** must survive an edit to the value with the label still bold in the overlay, the export, and extraction. Pinned in Tasks 3, 4, 5.
3. **Emptying a field** must whiten the line and remove its text from extraction/search, not leave stale text. Pinned in Tasks 4 and 7.
4. **A legacy block edit and a line edit on the same page** must both render and export. Pinned in Task 5.
5. **Clicking an existing line edit** must reopen it with its runs, not create a second edit on top. Pinned in Task 7.

---

### Task 1: Model, column split, runs, box selection

**Files:**
- Modify: `src/pdf/types.ts:7-9`
- Modify: `src/edit/blocks.ts`
- Test: `src/edit/blocks.test.ts`

**Interfaces:**
- Produces: `interface Run { text: string; font: EditFont; fontSize: number; color: RGB }`; `Edit` gains `kind?: "line"; runs?: Run[]; x?: number; baseline?: number`; `interface TextRun { items: TextItemBox[]; text: string; fontName: string; fontSize: number; x: number; width: number }`; `TextLine` gains `runs: TextRun[]` and `box: Box`; `linesInBox(lines: TextLine[], box: Box): TextLine[]`; `lineAt(lines: TextLine[], x: number, y: number, tol = 2): TextLine | undefined`; `lineBox(line: TextLine): Box`.

- [ ] **Step 1: Add the types**

In `src/pdf/types.ts` after `EditFont`/`LegacyEditFont`:

```ts
export interface Run { text: string; font: EditFont; fontSize: number; color: RGB }
export interface Edit {
  id: string; pageEntryId: string; boxes: Box[]; text: string; fontSize: number; font: EditFont; color: RGB; background?: RGB; lineHeight?: number; source?: "native" | "ocr"; blockKey?: string; region?: Box; frame?: Box;
  /** Line edit: ordered runs drawn left to right from (x, baseline); `region` is the original line box. `runs: []` whites the line out. */
  kind?: "line"; runs?: Run[]; x?: number; baseline?: number;
}
```

- [ ] **Step 2: Write the failing tests** (append to `src/edit/blocks.test.ts`; keep the existing tests)

```ts
import { linesInBox, lineAt, lineBox } from "./blocks";

describe("linesFrom columns and runs", () => {
  it("splits a baseline group at gaps wider than 1.2 em", () => {
    const lines = linesFrom([it_("Type", 20, 700, 24), it_("Fall", 48, 700, 20), it_("Finger", 300, 700, 36), it_("Stick", 340, 700, 30)]);
    expect(lines.map((l) => l.text)).toEqual(["Type Fall", "Finger Stick"]);
    expect(lines[0]).toMatchObject({ x: 20, width: 48 });
    expect(lines[1]).toMatchObject({ x: 300, width: 70 });
  });
  it("keeps a normal word gap on one line", () => {
    const lines = linesFrom([it_("Hello", 10, 700, 40), it_("world", 53, 700, 40)]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world"]);
  });
  it("merges consecutive items with the same font and size into runs", () => {
    const lines = linesFrom([it_("Assigned", 20, 700, 40, 10, "bold"), it_(" Caregiver", 60, 700, 50, 10, "bold"), it_("Rylee", 130, 700, 30, 10, "reg"), it_(" Lyons", 160, 700, 30, 10.1, "reg")]);
    expect(lines).toHaveLength(1);
    expect(lines[0].runs.map((r) => [r.text, r.fontName])).toEqual([["Assigned Caregiver", "bold"], ["Rylee Lyons", "reg"]]);
    expect(lines[0].runs[0]).toMatchObject({ x: 20, width: 90 });
  });
  it("starts a new run when the size differs by more than 2 %", () => {
    const lines = linesFrom([it_("A", 10, 700, 10, 10, "f"), it_("B", 20, 700, 10, 12, "f")]);
    expect(lines[0].runs).toHaveLength(2);
  });
  it("exposes a line box from baseline and font size", () => {
    const [line] = linesFrom([it_("x", 10, 700, 20, 10)]);
    expect(lineBox(line)).toEqual({ x: 10, y: 697.5, width: 20, height: 12 });
    expect(line.box).toEqual(lineBox(line));
  });
});

describe("linesInBox and lineAt", () => {
  const lines = linesFrom([it_("Left1", 20, 700, 40), it_("Right1", 300, 700, 40), it_("Left2", 20, 686, 40), it_("Right2", 300, 686, 40)]);
  it("selects lines overlapping the box by half their height and half a glyph", () => {
    expect(linesInBox(lines, { x: 10, y: 680, width: 100, height: 30 }).map((l) => l.text)).toEqual(["Left1", "Left2"]);
    expect(linesInBox(lines, { x: 10, y: 697, width: 100, height: 10 }).map((l) => l.text)).toEqual(["Left1"]);
    expect(linesInBox(lines, { x: 10, y: 710, width: 100, height: 2 })).toEqual([]);
  });
  it("finds the line under a point with a 2 pt tolerance", () => {
    expect(lineAt(lines, 25, 701)?.text).toBe("Left1");
    expect(lineAt(lines, 305, 687)?.text).toBe("Right2");
    expect(lineAt(lines, 200, 700)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/edit/blocks.test.ts`
Expected: FAIL (missing exports, missing `runs`/`box`).

- [ ] **Step 4: Implement in `src/edit/blocks.ts`**

Replace the `TextLine` interface and `linesFrom`, and add the helpers; keep `joins`, `blocksFrom`, `blockAt`, `blockKeyOf` unchanged (they still read `TextLine.text/x/baseline/width/fontSize/fontName`).

```ts
export interface TextRun { items: TextItemBox[]; text: string; fontName: string; fontSize: number; x: number; width: number }
export interface TextLine { text: string; x: number; baseline: number; width: number; fontSize: number; fontName: string; items: TextItemBox[]; runs: TextRun[]; box: Box }

const COLUMN_GAP = 1.2;   // em
const SIZE_TOL = 0.02;

function joinText(items: TextItemBox[]): string {
  let text = "", cursor = -Infinity;
  for (const p of items) {
    const gap = p.x - cursor;
    if (text && gap > p.fontSize * 0.15 && !text.endsWith(" ") && !p.str.startsWith(" ")) text += " ";
    text += p.str; cursor = p.x + p.width;
  }
  return text.replace(/\s+/g, " ").trim();
}

function runsOf(items: TextItemBox[]): TextRun[] {
  const runs: TextItemBox[][] = [];
  for (const p of items) {
    const r = runs[runs.length - 1];
    if (r && r[0].fontName === p.fontName && Math.abs(r[0].fontSize - p.fontSize) <= r[0].fontSize * SIZE_TOL) r.push(p); else runs.push([p]);
  }
  return runs.map((r) => ({ items: r, text: joinText(r), fontName: r[0].fontName, fontSize: r[0].fontSize, x: r[0].x, width: Math.max(...r.map((i) => i.x + i.width)) - r[0].x }));
}

export function lineBox(line: Pick<TextLine, "x" | "baseline" | "width" | "fontSize">): Box {
  return { x: line.x, y: line.baseline - line.fontSize * 0.25, width: line.width, height: line.fontSize * 1.2 };
}

function lineOf(g: TextItemBox[]): TextLine {
  const x = Math.min(...g.map((i) => i.x));
  const right = Math.max(...g.map((i) => i.x + i.width));
  const partial = { text: joinText(g), x, baseline: Math.min(...g.map((i) => i.y)), width: right - x, fontSize: g[0].fontSize, fontName: g[0].fontName, items: g, runs: runsOf(g) };
  return { ...partial, box: lineBox(partial) };
}

export function linesFrom(items: TextItemBox[]): TextLine[] {
  const placed = items.filter((i) => i.str.length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItemBox[][] = [];
  for (const p of placed) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - p.y) <= g[0].fontSize * 0.5) g.push(p); else groups.push([p]);
  }
  const out: TextLine[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    let seg: TextItemBox[] = [];
    for (const p of g) {
      const prev = seg[seg.length - 1];
      if (prev && p.x - (prev.x + prev.width) > COLUMN_GAP * prev.fontSize) { out.push(lineOf(seg)); seg = []; }
      seg.push(p);
    }
    if (seg.length) out.push(lineOf(seg));
  }
  return out;
}

export function linesInBox(lines: TextLine[], box: Box): TextLine[] {
  return lines.filter((l) => {
    const b = l.box;
    const vy = Math.min(b.y + b.height, box.y + box.height) - Math.max(b.y, box.y);
    const vx = Math.min(b.x + b.width, box.x + box.width) - Math.max(b.x, box.x);
    return vy >= b.height / 2 && vx >= l.fontSize * 0.5;
  });
}

export function lineAt(lines: TextLine[], x: number, y: number, tol = 2): TextLine | undefined {
  return lines.find((l) => x >= l.box.x - tol && x <= l.box.x + l.box.width + tol && y >= l.box.y - tol && y <= l.box.y + l.box.height + tol);
}
```

- [ ] **Step 5: Run the tests, the whole suite, and typecheck**

Run: `npx vitest run src/edit/blocks.test.ts && npx vitest run && npx tsc -b`
Expected: all pass. The first existing `linesFrom` test (`"Hello world"` with x 10/60 and widths 40/30: gap 10 = 1.0 em) still joins. `itemsToOcrPage` in `src/edit/flatten.ts` reads `l.items` only; unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/pdf/types.ts src/edit/blocks.ts src/edit/blocks.test.ts
git commit -m "feat(edit): line edit model; column-aware lines with styled runs; box and point selection"
```

---

### Task 2: Run styling and open-lines builder

**Files:**
- Create: `src/edit/runs.ts`
- Test: `src/edit/runs.test.ts`

**Interfaces:**
- Consumes: Task 1 `TextLine`, `TextRun`, `Run`; `fontInfoFor` from `src/edit/fontInfo.ts`; `matchFont` from `src/edit/fontMatch.ts`.
- Produces: `interface OpenLine { line: TextLine; runs: Run[]; existing?: Edit }`; `interface OpenLines { entry: PageEntry; source: SourceFile; box: Box; lines: OpenLine[]; background: RGB }`; `runsFor(line: TextLine, page: PdfPageLike, styles: Styles, color: RGB): Run[]`; `runsFromEdit(edit: Edit): Run[]`; `runsText(runs: Run[]): string`; `sameRuns(a: Run[], b: Run[]): boolean`; `type PdfPageLike = { commonObjs: { has(id: string): boolean; get(id: string): unknown } }`; `type Styles = Record<string, { fontFamily?: string }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/edit/runs.test.ts
import { describe, it, expect } from "vitest";
import { runsFor, runsFromEdit, runsText, sameRuns } from "./runs";
import { linesFrom } from "./blocks";
import type { TextItemBox } from "../pdf/text";
import type { Edit } from "../pdf/types";

const it_ = (str: string, x: number, w: number, fontName: string, size = 10): TextItemBox => ({ str, x, y: 700, width: w, height: size, fontSize: size, fontName });
const page = { commonObjs: { has: (id: string) => id === "g_bold", get: (id: string) => (id === "g_bold" ? { name: "Arial-BoldMT", bold: true } : null) } };
const styles = { g_reg: { fontFamily: "sans-serif" }, g_bold: { fontFamily: "sans-serif" } };

describe("runsFor", () => {
  it("matches a face per run and carries size and colour", () => {
    const [line] = linesFrom([it_("Label", 10, 40, "g_bold"), it_(" value", 50, 40, "g_reg")]);
    const runs = runsFor(line, page, styles, [0, 0, 0]);
    expect(runs).toEqual([{ text: "Label", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "value", font: "helvetica", fontSize: 10, color: [0, 0, 0] }]);
  });
  it("maps OCR items to one helvetica run", () => {
    const [line] = linesFrom([it_("scan", 10, 40, "ocr")]);
    expect(runsFor(line, page, styles, [0, 0, 0])).toEqual([{ text: "scan", font: "helvetica", fontSize: 10, color: [0, 0, 0] }]);
  });
});

describe("run helpers", () => {
  const runs = [{ text: "A", font: "helvetica-bold" as const, fontSize: 10, color: [0, 0, 0] as [number, number, number] }, { text: " b", font: "helvetica" as const, fontSize: 10, color: [0, 0, 0] as [number, number, number] }];
  it("joins run text", () => { expect(runsText(runs)).toBe("A b"); });
  it("compares runs by text, font, and size", () => {
    expect(sameRuns(runs, runs.map((r) => ({ ...r })))).toBe(true);
    expect(sameRuns(runs, [{ ...runs[0], text: "A!" }, runs[1]])).toBe(false);
    expect(sameRuns(runs, [{ ...runs[0], font: "helvetica" }, runs[1]])).toBe(false);
    expect(sameRuns(runs, [runs[0]])).toBe(false);
  });
  it("reads runs back from a line edit, or synthesises one from a legacy block edit", () => {
    const line: Edit = { id: "e", pageEntryId: "p", boxes: [], text: "A b", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0], kind: "line", runs };
    expect(runsFromEdit(line)).toEqual(runs);
    const legacy: Edit = { id: "f", pageEntryId: "p", boxes: [], text: "old", fontSize: 9, font: "times", color: [1, 0, 0] };
    expect(runsFromEdit(legacy)).toEqual([{ text: "old", font: "times", fontSize: 9, color: [1, 0, 0] }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/edit/runs.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/edit/runs.ts
import type { Box, Edit, PageEntry, RGB, Run, SourceFile } from "../pdf/types";
import type { TextLine } from "./blocks";
import { fontInfoFor } from "./fontInfo";
import { matchFont } from "./fontMatch";

export type PdfPageLike = { commonObjs: { has(id: string): boolean; get(id: string): unknown } };
export type Styles = Record<string, { fontFamily?: string }>;
export interface OpenLine { line: TextLine; runs: Run[]; existing?: Edit }
export interface OpenLines { entry: PageEntry; source: SourceFile; box: Box; lines: OpenLine[]; background: RGB }

/** One styled run per detected run: face from the source font's name and flags, size from the items, one text colour for the line. */
export function runsFor(line: TextLine, page: PdfPageLike, styles: Styles, color: RGB): Run[] {
  return line.runs.map((r) => ({ text: r.text, font: matchFont(fontInfoFor(page, r.fontName, styles)), fontSize: r.fontSize, color }));
}

export function runsFromEdit(edit: Edit): Run[] {
  if (edit.kind === "line") return (edit.runs ?? []).map((r) => ({ ...r }));
  return [{ text: edit.text, font: edit.font, fontSize: edit.fontSize, color: edit.color }];
}

export const runsText = (runs: Run[]): string => runs.map((r) => r.text).join("");

export function sameRuns(a: Run[], b: Run[]): boolean {
  return a.length === b.length && a.every((r, i) => r.text === b[i].text && r.font === b[i].font && Math.abs(r.fontSize - b[i].fontSize) < 1e-6);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/edit/runs.test.ts && npx tsc -b` — Expected: 5 passed, clean.

- [ ] **Step 5: Commit**

```bash
git add src/edit/runs.ts src/edit/runs.test.ts
git commit -m "feat(edit): per-run face matching and run helpers"
```

---

### Task 3: One layout for both edit kinds (`placePieces`)

**Files:**
- Modify: `src/edit/layout.ts`
- Test: `src/edit/layout.test.ts` (append)

**Interfaces:**
- Consumes: existing `placeEdit`, `regionOf`; Task 1 `Edit.kind/runs/x/baseline`.
- Produces: `interface Piece { text: string; x: number; baseline: number; width: number; font: EditFont; fontSize: number; color: RGB }`; `type Measures = (font: EditFont) => Measure`; `placePieces(edit: Edit, measures: Measures): { pieces: Piece[]; boxes: Box[] }`; `lineFrame(edit: Edit): Box` (frame ?? region ?? regionOf(boxes)).

- [ ] **Step 1: Write the failing tests** (append to `src/edit/layout.test.ts`; read its existing helpers first and reuse its `measure` if one exists, else define `const m = (t: string, s: number) => t.length * s * 0.5`)

```ts
import { placePieces, lineFrame } from "./layout";
import type { Edit } from "../pdf/types";

describe("placePieces", () => {
  const m = (t: string, s: number) => t.length * s * 0.5;
  const measures = () => m;
  const lineEdit: Edit = { id: "l", pageEntryId: "p", kind: "line", x: 20, baseline: 700, region: { x: 20, y: 697.5, width: 120, height: 12 }, runs: [{ text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "value", font: "helvetica", fontSize: 10, color: [0.2, 0.2, 0.2] }], boxes: [{ x: 20, y: 697.5, width: 120, height: 12 }], text: "Label value", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0] };
  it("lays runs left to right from x at the baseline, each with its own face", () => {
    const { pieces, boxes } = placePieces(lineEdit, measures);
    expect(pieces).toEqual([
      { text: "Label ", x: 20, baseline: 700, width: 30, font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] },
      { text: "value", x: 50, baseline: 700, width: 25, font: "helvetica", fontSize: 10, color: [0.2, 0.2, 0.2] },
    ]);
    expect(boxes).toEqual([lineEdit.region]);
  });
  it("offsets runs by a moved frame and keeps the original region covered", () => {
    const moved = { ...lineEdit, frame: { x: 30, y: 657.5, width: 120, height: 12 } };
    const { pieces, boxes } = placePieces(moved, measures);
    expect(pieces[0]).toMatchObject({ x: 30, baseline: 660 });
    expect(boxes).toEqual([lineEdit.region, moved.frame]);
  });
  it("whites out an emptied line: covers only, no pieces", () => {
    const { pieces, boxes } = placePieces({ ...lineEdit, runs: [], text: "" }, measures);
    expect(pieces).toEqual([]);
    expect(boxes).toEqual([lineEdit.region]);
  });
  it("turns a legacy block edit into one piece per laid-out line in the block's font", () => {
    const legacy: Edit = { id: "b", pageEntryId: "p", boxes: [{ x: 10, y: 690, width: 100, height: 12 }], region: { x: 10, y: 690, width: 100, height: 12 }, text: "hello", fontSize: 10, font: "times", color: [0, 0, 1], lineHeight: 12 };
    const { pieces, boxes } = placePieces(legacy, measures);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ text: "hello", font: "times", fontSize: 10, color: [0, 0, 1], x: 10 });
    expect(boxes.length).toBeGreaterThan(0);
  });
  it("lineFrame prefers frame, then region, then the boxes' bounds", () => {
    expect(lineFrame(lineEdit)).toEqual(lineEdit.region);
    expect(lineFrame({ ...lineEdit, frame: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(lineFrame({ ...lineEdit, region: undefined })).toEqual({ x: 20, y: 697.5, width: 120, height: 12 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/edit/layout.test.ts` — Expected: FAIL (`placePieces` not exported).

- [ ] **Step 3: Implement** (append to `src/edit/layout.ts`; import `EditFont`, `RGB`, `Run` from `../pdf/types`)

```ts
export interface Piece { text: string; x: number; baseline: number; width: number; font: EditFont; fontSize: number; color: RGB }
export type Measures = (font: EditFont) => Measure;

export function lineFrame(edit: Pick<Edit, "frame" | "region" | "boxes">): Box {
  return edit.frame ?? edit.region ?? regionOf(edit.boxes);
}

/**
 * The one layout for every edit kind. Line edits: runs left to right from (x, baseline), shifted by the frame's offset
 * from the region when moved; covers are the original region plus the frame when moved. Legacy block edits: the
 * existing `placeEdit` layout, one piece per line in the block's font.
 */
export function placePieces(edit: Edit, measures: Measures): { pieces: Piece[]; boxes: Box[] } {
  if (edit.kind === "line") {
    const region = edit.region ?? regionOf(edit.boxes);
    const frame = edit.frame ?? region;
    const dx = frame.x - region.x, dy = frame.y - region.y;
    let x = (edit.x ?? region.x) + dx;
    const baseline = (edit.baseline ?? region.y + region.height * 0.25 / 1.2) + dy;
    const pieces: Piece[] = [];
    for (const r of edit.runs ?? []) {
      if (!r.text) continue;
      const width = measures(r.font)(r.text, r.fontSize);
      pieces.push({ text: r.text, x, baseline, width, font: r.font, fontSize: r.fontSize, color: r.color });
      x += width;
    }
    return { pieces, boxes: edit.frame ? [region, frame] : [region] };
  }
  const font = normalizeFont(edit.font);
  const { lines, boxes, fontSize } = placeEdit(edit, measures(font));
  return { pieces: lines.map((l) => ({ text: l.text, x: l.x, baseline: l.baseline, width: measures(font)(l.text, fontSize), font, fontSize, color: edit.color })), boxes };
}
```
(import `normalizeFont` from `../pdf/fonts`.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/edit/layout.test.ts && npx tsc -b` — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/edit/layout.ts src/edit/layout.test.ts
git commit -m "feat(edit): placePieces lays out line and block edits into per-run pieces"
```

---

### Task 4: Extraction and search see runs

**Files:**
- Modify: `src/pdf/text.ts:81-93` (`applyEdits`)
- Test: `src/pdf/text.test.ts` (append; read the file's existing helpers for building a store state first)

**Interfaces:**
- Consumes: Task 3 `placePieces`; `measureFor` from `src/pdf/metrics.ts`; existing `coveredBy`.
- Produces: no new exports; `extractPageText` now yields one `TextItemBox` per piece with `fontName = piece.font` for line edits (legacy block edits unchanged in effect).

- [ ] **Step 1: Write the failing test** (append; follow the file's existing pattern for seeding `useDocumentStore` edits and calling `extractPageText` with a stubbed `getPage`, or, if the existing tests exercise `applyEdits` via an exported helper, export `applyEdits` for testing and call it directly)

```ts
describe("applyEdits with line edits", () => {
  it("replaces the covered items with one item per run, carrying each run's face", async () => {
    const items: TextItemBox[] = [
      { str: "Assigned Caregiver", x: 20, y: 700, width: 90, height: 10, fontSize: 10, fontName: "g_bold" },
      { str: "Rylee Lyons", x: 130, y: 700, width: 60, height: 10, fontSize: 10, fontName: "g_reg" },
      { str: "Other line", x: 20, y: 686, width: 60, height: 10, fontSize: 10, fontName: "g_reg" },
    ];
    const edit: Edit = { id: "e", pageEntryId: "p", kind: "line", x: 130, baseline: 700, region: { x: 130, y: 697.5, width: 60, height: 12 }, boxes: [{ x: 130, y: 697.5, width: 60, height: 12 }], runs: [{ text: "Jamie Lee", font: "helvetica", fontSize: 10, color: [0, 0, 0] }], text: "Jamie Lee", fontSize: 10, font: "helvetica", color: [0, 0, 0] };
    const out = await applyEdits(items, [edit]);
    expect(out.map((i) => i.str)).toEqual(["Assigned Caregiver", "Other line", "Jamie Lee"]);
    expect(out[2]).toMatchObject({ x: 130, y: 700, fontName: "helvetica", fontSize: 10 });
  });
  it("an emptied line edit removes the covered text and adds nothing", async () => {
    const items: TextItemBox[] = [{ str: "gone", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "g" }];
    const edit: Edit = { id: "e", pageEntryId: "p", kind: "line", x: 20, baseline: 700, region: { x: 20, y: 697.5, width: 30, height: 12 }, boxes: [{ x: 20, y: 697.5, width: 30, height: 12 }], runs: [], text: "", fontSize: 10, font: "helvetica", color: [0, 0, 0] };
    expect(await applyEdits(items, [edit])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pdf/text.test.ts` — Expected: FAIL (`applyEdits` not exported / items not per run).

- [ ] **Step 3: Implement** (replace `applyEdits` in `src/pdf/text.ts`; export it)

```ts
export async function applyEdits(items: TextItemBox[], edits: Edit[]): Promise<TextItemBox[]> {
  if (!edits.length) return items;
  const faces = new Set<EditFont>();
  for (const e of edits) { if (e.kind === "line") for (const r of e.runs ?? []) faces.add(r.font); else faces.add(normalizeFont(e.font)); }
  const measures = new Map<EditFont, Measure>();
  await Promise.all([...faces].map(async (f) => measures.set(f, await measureFor(f))));
  const placed = edits.map((e) => placePieces(e, (f) => measures.get(f)!));
  const covers = placed.flatMap((p) => p.boxes);
  let out = items.filter((i) => !coveredBy(i, covers));
  for (const { pieces } of placed) {
    out = out.concat(pieces.map((p) => ({ str: p.text, x: p.x, y: p.baseline, width: p.width, height: p.fontSize, fontSize: p.fontSize, fontName: p.font })));
  }
  return out;
}
```
(imports: `placePieces` from `../edit/layout`, `EditFont` type, `Measure` from `./layout`.) Remove the now-unused `placeEdit` import if nothing else in the file uses it.

- [ ] **Step 4: Run the suite and typecheck**

Run: `npx vitest run && npx tsc -b` — Expected: pass (legacy tests unchanged because `placePieces` reproduces `placeEdit` for block edits).

- [ ] **Step 5: Commit**

```bash
git add src/pdf/text.ts src/pdf/text.test.ts
git commit -m "feat(edit): text extraction and search index see line edits per run"
```

---

### Task 5: Export draws pieces; overlay renders pieces; handles move line frames

**Files:**
- Modify: `src/pdf/pageOps.ts:75-100`
- Modify: `src/components/EditOverlay.tsx`
- Modify: `src/components/EditHandles.tsx:20,60-64`
- Test: `src/pdf/pageOps.test.ts` (append), `src/components/EditOverlay.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 `placePieces`, `Piece`, `lineFrame`; `STANDARD_FONTS`, `FONT_CSS`, `normalizeFont`; `usePdfMeasure`.
- Produces: no new exports. Overlay markup: covers `.edit-box` (unchanged), text `.edit-line` now one per piece with `data-run`.

- [ ] **Step 1: Write the failing export test** (append to `src/pdf/pageOps.test.ts`; read its helpers for building a source/page/edits and parsing the output with pdf-lib)

```ts
it("draws a line edit's runs in their own faces and no longer contains the original text", async () => {
  // Build a one-page source with "Label value" where "Label" is Helvetica-Bold and "value" Helvetica (pdf-lib), then a line edit replacing "value" with "VALUE" keeping the bold label.
  const src = await makeSource(async (page, fonts) => {
    page.drawText("Label ", { x: 20, y: 700, size: 10, font: fonts.bold });
    page.drawText("value", { x: 50, y: 700, size: 10, font: fonts.regular });
  });
  const edit: Edit = { id: "e", pageEntryId: entryId(src), kind: "line", x: 20, baseline: 700, region: { x: 20, y: 697.5, width: 55, height: 12 }, boxes: [{ x: 20, y: 697.5, width: 55, height: 12 }], runs: [{ text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "VALUE", font: "helvetica", fontSize: 10, color: [0, 0, 0] }], text: "Label VALUE", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0] };
  const bytes = await buildDocument(/* same args the existing export tests use, with edits: [edit] and the rasterize/editedText opts the flatten test uses */);
  const doc = await PDFDocument.load(bytes);
  const fontNames = fontsOnPage(doc, 0); // helper in the test file, or: enumerate page.node.Resources() Font dict BaseFont values
  expect(fontNames).toEqual(expect.arrayContaining(["Helvetica-Bold", "Helvetica"]));
  const text = await textOf(bytes, 0);
  expect(text).toContain("VALUE");
  expect(text).not.toContain("value");
});
```
If the file has no `makeSource`/`fontsOnPage`/`textOf` helpers, write them in the test file: `makeSource` creates a pdf-lib document with `StandardFonts.HelveticaBold`/`Helvetica` embedded, `fontsOnPage` walks `page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict)` and collects `BaseFont` names, `textOf` uses `pdfjs-dist/legacy/build/pdf.mjs` via `src/test/pdfjs.ts` `openPdf` as the other tests do.

- [ ] **Step 2: Write the failing overlay test** (append to `src/components/EditOverlay.test.ts`; read how it currently renders and asserts `.edit-line`)

```ts
it("renders one text element per run with the run's face", () => {
  const edit: Edit = { id: "e", pageEntryId: "p", kind: "line", x: 20, baseline: 700, region: { x: 20, y: 697.5, width: 55, height: 12 }, boxes: [{ x: 20, y: 697.5, width: 55, height: 12 }], runs: [{ text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "value", font: "helvetica", fontSize: 10, color: [0, 0, 0] }], text: "Label value", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0] };
  const { container } = render(<EditOverlay edits={[edit]} scale={1} pageHeightPt={800} pageWidthPt={600} rotation={0} />);
  const runs = [...container.querySelectorAll(".edit-line")];
  expect(runs.map((r) => r.textContent)).toEqual(["Label ", "value"]);
  expect((runs[0] as HTMLElement).style.font).toContain("bold");
  expect((runs[1] as HTMLElement).style.font).not.toContain("bold");
  expect(parseFloat((runs[1] as HTMLElement).style.left)).toBeGreaterThan(parseFloat((runs[0] as HTMLElement).style.left));
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run src/pdf/pageOps.test.ts src/components/EditOverlay.test.ts` — Expected: FAIL.

- [ ] **Step 4: Implement the exporter** (replace the `plans`/`drawEdits` block in `src/pdf/pageOps.ts`)

```ts
    const fontCache = new Map<EditFont, PDFFont>();
    const fontFor = async (f: EditFont) => fontCache.get(f) ?? (fontCache.set(f, await out.embedFont(STANDARD_FONTS[f])), fontCache.get(f)!);
    const faces = new Set<EditFont>();
    for (const e of pageEdits) { if (e.kind === "line") for (const r of e.runs ?? []) faces.add(r.font); else faces.add(normalizeFont(e.font)); }
    for (const f of faces) await fontFor(f);
    const measures = (f: EditFont) => (t: string, sz: number) => fontCache.get(f)!.widthOfTextAtSize(toWinAnsi(t), sz);
    // One layout per edit, shared by the covers handed to the rasterizer, the drawing, and the OCR omission below.
    const plans = pageEdits.map((e) => ({ e, ...placePieces(e, measures) }));
    const drawEdits = async () => {
      for (const { e, pieces, boxes } of plans) {
        for (const b of boxes) copied.drawRectangle({ x: b.x + ox, y: b.y + oy, width: b.width, height: b.height, color: rgb(...(e.background ?? [1, 1, 1])) });
        for (const p of pieces) {
          const drawOpts = { x: p.x + ox, y: p.baseline + oy, size: p.fontSize, font: fontCache.get(p.font)!, color: rgb(p.color[0], p.color[1], p.color[2]) };
          const drawn = toWinAnsi(p.text);
          try { copied.drawText(drawn, drawOpts); }
          catch { copied.drawText(drawn.replace(/[^\x20-\x7E]/g, "?"), drawOpts); }
        }
      }
    };
```
Then update the later uses of `plans` in the same function: wherever it read `plan.boxes` for the rasterizer covers, keep `boxes`; wherever it read `plan.lines`/`fontSize`, use `pieces`. Read the rest of `buildDocument` before editing and keep the flatten/OCR logic intact.

- [ ] **Step 5: Implement the overlay** (`src/components/EditOverlay.tsx`)

```tsx
  const faces = useMemo(() => [...new Set(edits.flatMap((e) => (e.kind === "line" ? (e.runs ?? []).map((r) => r.font) : [normalizeFont(e.font)])))], [edits]);
  const pdfMeasure = usePdfMeasure(faces);
  const measures = (f: EditFont) => pdfMeasure[f] ?? measureCss(f);
  const laid = useMemo(() => edits.map((e) => ({ e, ...placePieces(e, measures) })), [edits, pdfMeasure]); // eslint-disable-line react-hooks/exhaustive-deps
  ...
      {laid.map(({ e, pieces, boxes }) => (
        <div key={e.id} className="edit" data-edit-id={e.id}>
          {boxes.map((b, i) => <div key={i} className="edit-box" style={{ left: b.x * scale, top: (pageHeightPt - b.y - b.height) * scale, width: b.width * scale, height: b.height * scale, background: `rgb(${(e.background ?? [1, 1, 1]).map((c) => c * 255).join(",")})` }} />)}
          {pieces.map((p, i) => <div key={i} className="edit-line" data-run style={{ left: p.x * scale, top: (pageHeightPt - p.baseline - p.fontSize) * scale, font: FONT_CSS[p.font].replace("1px", `${p.fontSize * scale}px`), color: `rgb(${p.color.map((c) => c * 255).join(",")})` }}>{p.text}</div>)}
        </div>
      ))}
```
Keep `measureCss` and `overlayTransform` exports and the `EditHandles` rendering unchanged.

- [ ] **Step 6: Handles for line edits** (`src/components/EditHandles.tsx`)

Replace `const frame = edit.frame ?? edit.region ?? regionOf(edit.boxes);` with `const frame = lineFrame(edit);` and, in the commit of a drag/width gesture, compute `boxes` with `placePieces({ ...cur, region, frame: next }, measures).boxes` where `measures` wraps the single `m` already available there (`(f) => m` is acceptable: for line edits the width only affects the cover, for block edits it is the block's own font). Keep the font menu rendering only when `edit.kind !== "line"`.

- [ ] **Step 7: Run everything**

Run: `npx vitest run && npx tsc -b` — Expected: pass, including the existing EditHandles and EditOverlay tests.

- [ ] **Step 8: Commit**

```bash
git add src/pdf/pageOps.ts src/pdf/pageOps.test.ts src/components/EditOverlay.tsx src/components/EditOverlay.test.ts src/components/EditHandles.tsx
git commit -m "feat(edit): export, overlay, and handles work from per-run pieces"
```

---

### Task 6: The line editor component

**Files:**
- Create: `src/components/LineEditor.tsx`
- Modify: `src/styles.css` (append)
- Test: `src/components/LineEditor.test.tsx`

**Interfaces:**
- Consumes: Task 2 `OpenLine`, `runsText`, `sameRuns`; Task 3 `lineFrame`; `measureFor`; `FONT_CSS`; `useDocumentStore.addEdit/updateEdit`.
- Produces: `export default function LineEditor({ open, scale, heightPt, onClose }: { open: OpenLines; scale: number; heightPt: number; onClose(): void })`; `readRuns(el: HTMLElement, template: Run[]): Run[]` (exported for tests).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/LineEditor.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import LineEditor, { readRuns, type OpenLines } from "./LineEditor";
import { useDocumentStore } from "../store/document";
import { linesFrom } from "../edit/blocks";
import type { Run } from "../pdf/types";

vi.mock("../pdf/metrics", () => ({ measureFor: async () => (t: string, s: number) => t.length * s * 0.5 }));

const bold: Run = { text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] };
const reg: Run = { text: "value", font: "helvetica", fontSize: 10, color: [0, 0, 0] };
function openLines(): OpenLines {
  const [line1] = linesFrom([{ str: "Label ", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "b" }, { str: "value", x: 50, y: 700, width: 25, height: 10, fontSize: 10, fontName: "r" }]);
  const [line2] = linesFrom([{ str: "Second", x: 20, y: 686, width: 30, height: 10, fontSize: 10, fontName: "r" }]);
  return { entry: { id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }, source: { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" }, box: { x: 15, y: 680, width: 100, height: 32 }, background: [1, 1, 1], lines: [{ line: line1, runs: [bold, reg] }, { line: line2, runs: [{ ...reg, text: "Second" }] }] };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => { useDocumentStore.setState({ ...useDocumentStore.getState(), edits: [], pages: [{ id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] }); });
afterEach(cleanup);

describe("readRuns", () => {
  it("reads spans back into runs and drops empty ones", () => {
    const el = document.createElement("div");
    el.innerHTML = '<span data-run="0">Label </span><span data-run="1"></span><span data-run="2">x</span>';
    expect(readRuns(el, [bold, reg, reg])).toEqual([{ ...bold }, { ...reg, text: "x" }]);
  });
});

describe("LineEditor", () => {
  it("renders one field per line with styled spans", async () => {
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const fields = screen.getAllByTestId("line-field");
    expect(fields).toHaveLength(2);
    const spans = fields[0].querySelectorAll("[data-run]");
    expect(spans).toHaveLength(2);
    expect((spans[0] as HTMLElement).style.font).toContain("bold");
    expect(spans[1].textContent).toBe("value");
  });
  it("applies only changed lines, keeping the bold run", async () => {
    const onClose = vi.fn();
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={onClose} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "VALUE";
    fireEvent.input(field);
    fireEvent.click(screen.getByTestId("line-done"));
    await flush();
    const edits = useDocumentStore.getState().edits;
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ kind: "line", x: 20, baseline: 700, runs: [bold, { ...reg, text: "VALUE" }], text: "Label VALUE", region: { x: 20, y: 697.5, width: 55, height: 12 } });
    expect(onClose).toHaveBeenCalled();
  });
  it("an emptied field becomes a white-out edit", async () => {
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[1];
    field.querySelector('[data-run="0"]')!.textContent = "";
    fireEvent.input(field);
    fireEvent.keyDown(field, { key: "Enter" });
    await flush();
    expect(useDocumentStore.getState().edits[0]).toMatchObject({ kind: "line", runs: [], text: "" });
  });
  it("Escape applies nothing", async () => {
    const onClose = vi.fn();
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={onClose} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "changed";
    fireEvent.input(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(useDocumentStore.getState().edits).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });
  it("shows the overflow note when the runs exceed the box", async () => {
    render(<LineEditor open={openLines()} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "a very long value that does not fit the drawn box";
    fireEvent.input(field);
    expect(screen.getByTestId("line-overflow").textContent).toBe("Text wider than the box");
  });
  it("updates a reopened edit in place", async () => {
    const open = openLines();
    const id = useDocumentStore.getState().addEdit({ pageEntryId: "p0", kind: "line", x: 20, baseline: 700, region: open.lines[0].line.box, boxes: [open.lines[0].line.box], runs: [bold, reg], text: "Label value", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0], background: [1, 1, 1] });
    open.lines[0].existing = useDocumentStore.getState().edits[0];
    render(<LineEditor open={open} scale={1} heightPt={800} onClose={() => {}} />);
    await flush();
    const field = screen.getAllByTestId("line-field")[0];
    field.querySelector('[data-run="1"]')!.textContent = "again";
    fireEvent.input(field);
    fireEvent.click(screen.getByTestId("line-done"));
    await flush();
    const edits = useDocumentStore.getState().edits;
    expect(edits).toHaveLength(1);
    expect(edits[0].id).toBe(id);
    expect(edits[0].runs?.[1].text).toBe("again");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/LineEditor.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// src/components/LineEditor.tsx
import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { measureFor } from "../pdf/metrics";
import { FONT_CSS } from "../pdf/fonts";
import type { Measure } from "../pdf/layout";
import type { EditFont, Run } from "../pdf/types";
import { runsText, sameRuns, type OpenLines } from "../edit/runs";
export type { OpenLines } from "../edit/runs";

const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/** Spans with data-run carry the run index they were created from; their text is the edited text, their style comes from the template. */
export function readRuns(el: HTMLElement, template: Run[]): Run[] {
  const out: Run[] = [];
  for (const span of el.querySelectorAll<HTMLElement>("[data-run]")) {
    const i = Number(span.dataset.run);
    const text = (span.textContent ?? "").replace(/ /g, " ");
    if (!text || !template[i]) continue;
    out.push({ ...template[i], text });
  }
  return out;
}

function widthOf(runs: Run[], measures: Partial<Record<EditFont, Measure>>): number {
  return runs.reduce((w, r) => w + (measures[r.font]?.(r.text, r.fontSize) ?? r.text.length * r.fontSize * 0.5), 0);
}

export default function LineEditor({ open, scale, heightPt, onClose }: { open: OpenLines; scale: number; heightPt: number; onClose(): void }) {
  const [measures, setMeasures] = useState<Partial<Record<EditFont, Measure>>>({});
  const [current, setCurrent] = useState<Run[][]>(open.lines.map((l) => l.runs.map((r) => ({ ...r }))));
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const finished = useRef(false);

  useEffect(() => {
    let on = true;
    const faces = [...new Set(open.lines.flatMap((l) => l.runs.map((r) => r.font)))];
    void Promise.all(faces.map(async (f) => [f, await measureFor(f)] as const)).then((pairs) => { if (on) setMeasures(Object.fromEntries(pairs)); });
    return () => { on = false; };
  }, [open]);
  useEffect(() => { refs.current[0]?.focus(); }, []);

  const finish = () => { if (finished.current) return false; finished.current = true; return true; };
  const cancel = () => { if (finish()) onClose(); };
  const apply = () => {
    if (!finish()) return;
    try {
      const { addEdit, updateEdit } = useDocumentStore.getState();
      open.lines.forEach((l, i) => {
        const el = refs.current[i];
        const runs = el ? readRuns(el, l.runs) : current[i];
        if (sameRuns(runs, l.runs)) return;
        const region = l.line.box;
        const first = runs[0] ?? l.runs[0];
        const base = { kind: "line" as const, x: l.line.x, baseline: l.line.baseline, region, boxes: [region], runs, text: runsText(runs), fontSize: first.fontSize, font: first.font, color: first.color, background: open.background, source: (l.line.fontName === "ocr" ? "ocr" : "native") as "ocr" | "native" };
        if (l.existing) updateEdit(l.existing.id, base); else addEdit({ pageEntryId: open.entry.id, ...base });
      });
    } catch (err) {
      console.error("Could not apply edits", err);
    } finally { onClose(); }
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Tab") { e.preventDefault(); refs.current[i + (e.shiftKey ? -1 : 1)]?.focus(); }
  };
  const onInput = (i: number) => { const el = refs.current[i]; if (el) setCurrent((c) => c.map((r, k) => (k === i ? readRuns(el, open.lines[i].runs) : r))); };
  const right = open.box.x + open.box.width;

  return (
    <div className="line-editor" data-testid="line-editor">
      {open.lines.map((l, i) => {
        const overflow = widthOf(current[i], measures) > right - l.line.x + 0.5;
        const width = Math.max(l.line.width, right - l.line.x);
        return (
          <div key={i} className="line-field-wrap" style={{ left: l.line.x * scale, top: (heightPt - l.line.baseline - l.line.fontSize) * scale, width: width * scale }}>
            <div ref={(el) => { refs.current[i] = el; }} data-testid="line-field" data-line-index={i} className={`line-field ${overflow ? "overflow" : ""}`} contentEditable suppressContentEditableWarning spellCheck={false}
              style={{ background: rgb(open.background), lineHeight: 1 }}
              onInput={() => onInput(i)} onKeyDown={(e) => onKey(e, i)}
              onBeforeInput={(e) => {
                // Keep typing inside the caret's run so the new text inherits its style; the browser's default does this for text nodes inside a span.
                const ev = e.nativeEvent as InputEvent;
                if (ev.inputType === "insertFromPaste") { e.preventDefault(); document.execCommand("insertText", false, ev.dataTransfer?.getData("text/plain") ?? ""); }
              }}>
              {l.runs.map((r, k) => <span key={k} data-run={k} style={{ font: FONT_CSS[r.font].replace("1px", `${r.fontSize * scale}px`), color: rgb(r.color) }}>{r.text}</span>)}
            </div>
            {overflow && <span className="line-overflow" data-testid="line-overflow">Text wider than the box</span>}
          </div>
        );
      })}
      <div className="line-editor-bar" style={{ left: open.box.x * scale, top: (heightPt - open.box.y) * scale + 4 }}>
        <button data-testid="line-done" onMouseDown={(e) => e.preventDefault()} onClick={apply}>Done</button>
        <button data-testid="line-cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
```

Append to `src/styles.css`:

```css
.line-editor { position: absolute; inset: 0; z-index: 30; pointer-events: none; }
.line-field-wrap { position: absolute; pointer-events: auto; }
.line-field { outline: 1px solid #2563eb; white-space: pre; overflow: visible; min-width: 1em; }
.line-field.overflow { outline-color: var(--danger); }
.line-overflow { position: absolute; left: 0; top: 100%; font-size: 11px; color: var(--danger); white-space: nowrap; }
.line-editor-bar { position: absolute; pointer-events: auto; display: flex; gap: 6px; font-size: 12px; background: var(--bg, white); border: 1px solid var(--border, #ccc); border-radius: 4px; padding: 2px 6px; }
.drag-box { position: absolute; border: 1px dashed #2563eb; background: rgba(37, 99, 235, 0.08); pointer-events: none; }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/components/LineEditor.test.tsx && npx tsc -b` — Expected: 7 passed. If `addEdit`'s type rejects `kind`/`runs`, its parameter is `Omit<Edit, "id" | "font"> & { font }`, which already includes the new optional fields; if `region`'s required-ness bites, keep it optional in the type and always set it from the editor.

- [ ] **Step 5: Commit**

```bash
git add src/components/LineEditor.tsx src/components/LineEditor.test.tsx src/styles.css
git commit -m "feat(edit): LineEditor with one styled field per line"
```

---

### Task 7: Drag-box targeting in PageView

**Files:**
- Create: `src/components/DragBox.tsx`
- Create: `src/edit/openLines.ts`
- Modify: `src/components/PageView.tsx` (edit-tool handlers; keep BlockEditor for reopening legacy block edits)
- Test: `src/components/DragBox.test.tsx`, `src/edit/openLines.test.ts`

**Interfaces:**
- Consumes: Task 1 `linesInBox`, `lineAt`; Task 2 `runsFor`, `runsFromEdit`, `OpenLine`; Task 6 `OpenLines`, `LineEditor`; `pageBlocks` (its `PageBlocks` now also needs `lines`: add `lines: TextLine[]` to its result, computed once from the same items); `sampleBlockColors`.
- Produces: `openLinesIn(source, entry, box, page, colors): Promise<OpenLines | null>` (null when no lines; includes existing line edits overlapping the box as reopenable lines); `useDragBox(onSelect: (box: Box | null, click: { x: number; y: number }) => void, toPage: (clientX, clientY) => { x, y })` hook returning `{ handlers: { onPointerDown, onPointerMove, onPointerUp }, box: Box | null }`; `<DragBox box scale heightPt />` renders the dashed rectangle with `data-testid="drag-box"`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/edit/openLines.test.ts
import { describe, it, expect } from "vitest";
import { openLinesIn } from "./openLines";
import { useDocumentStore } from "../store/document";
import type { TextItemBox } from "../pdf/text";

const items: TextItemBox[] = [
  { str: "Label ", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "b" }, { str: "value", x: 50, y: 700, width: 25, height: 10, fontSize: 10, fontName: "r" },
  { str: "Right", x: 300, y: 700, width: 30, height: 10, fontSize: 10, fontName: "r" },
  { str: "Second", x: 20, y: 686, width: 30, height: 10, fontSize: 10, fontName: "r" },
];
const page = { commonObjs: { has: (id: string) => id === "b", get: () => ({ name: "Arial-BoldMT", bold: true }) } };
const entry = { id: "p0", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const };
const source = { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1, hash: "h" };

describe("openLinesIn", () => {
  it("returns one open line per detected line inside the box, with runs", async () => {
    useDocumentStore.setState({ ...useDocumentStore.getState(), edits: [], pages: [entry] });
    const open = await openLinesIn({ items, page, styles: {} }, source, entry, { x: 10, y: 680, width: 100, height: 32 }, { background: [1, 1, 1], text: [0, 0, 0] });
    expect(open?.lines.map((l) => l.runs.map((r) => r.text))).toEqual([["Label ", "value"], ["Second"]]);
    expect(open?.lines[0].runs[0].font).toBe("helvetica-bold");
  });
  it("returns null when the box holds no lines", async () => {
    expect(await openLinesIn({ items, page, styles: {} }, source, entry, { x: 150, y: 680, width: 50, height: 32 }, { background: [1, 1, 1], text: [0, 0, 0] })).toBeNull();
  });
  it("includes an existing line edit overlapping the box as a reopenable line with its stored runs", async () => {
    const region = { x: 20, y: 697.5, width: 55, height: 12 };
    useDocumentStore.setState({ ...useDocumentStore.getState(), pages: [entry], edits: [{ id: "e", pageEntryId: "p0", kind: "line", x: 20, baseline: 700, region, boxes: [region], runs: [{ text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "VALUE", font: "helvetica", fontSize: 10, color: [0, 0, 0] }], text: "Label VALUE", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0] }] });
    // Extraction already applied the edit: items for that line are the edit's runs.
    const edited: TextItemBox[] = [{ str: "Label ", x: 20, y: 700, width: 30, height: 10, fontSize: 10, fontName: "helvetica-bold" }, { str: "VALUE", x: 50, y: 700, width: 25, height: 10, fontSize: 10, fontName: "helvetica" }, items[3]];
    const open = await openLinesIn({ items: edited, page, styles: {} }, source, entry, { x: 10, y: 680, width: 100, height: 32 }, { background: [1, 1, 1], text: [0, 0, 0] });
    expect(open?.lines[0].existing?.id).toBe("e");
    expect(open?.lines[0].runs.map((r) => r.text)).toEqual(["Label ", "VALUE"]);
  });
});
```

```tsx
// src/components/DragBox.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragBox } from "./DragBox";

describe("useDragBox", () => {
  const toPage = (cx: number, cy: number) => ({ x: cx, y: 800 - cy });
  it("reports a click for movement under 3 px and a box otherwise", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useDragBox(onSelect, toPage));
    const ev = (clientX: number, clientY: number) => ({ clientX, clientY, button: 0, preventDefault() {}, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} }, pointerId: 1 }) as unknown as React.PointerEvent<HTMLElement>;
    act(() => { result.current.handlers.onPointerDown(ev(10, 10)); result.current.handlers.onPointerUp(ev(11, 12)); });
    expect(onSelect).toHaveBeenLastCalledWith(null, { x: 10, y: 790 });
    act(() => { result.current.handlers.onPointerDown(ev(10, 10)); result.current.handlers.onPointerMove(ev(60, 40)); });
    expect(result.current.box).toEqual({ x: 10, y: 760, width: 50, height: 30 });
    act(() => { result.current.handlers.onPointerUp(ev(60, 40)); });
    expect(onSelect).toHaveBeenLastCalledWith({ x: 10, y: 760, width: 50, height: 30 }, { x: 10, y: 790 });
    expect(result.current.box).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/edit/openLines.test.ts src/components/DragBox.test.tsx` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/edit/openLines.ts`**

```ts
import type { Box, Edit, PageEntry, RGB, SourceFile } from "../pdf/types";
import type { TextItemBox } from "../pdf/text";
import { linesFrom, linesInBox, type TextLine } from "./blocks";
import { runsFor, runsFromEdit, type OpenLine, type OpenLines, type PdfPageLike, type Styles } from "./runs";
import { useDocumentStore } from "../store/document";
import { lineFrame } from "./layout";

export interface PageTextForEdit { items: TextItemBox[]; page: PdfPageLike; styles: Styles }

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Lines inside the box, as editable runs; a line whose box overlaps an existing line edit reopens that edit. */
export async function openLinesIn(text: PageTextForEdit, source: SourceFile, entry: PageEntry, box: Box, colors: { background: RGB; text: RGB }): Promise<OpenLines | null> {
  const lines: TextLine[] = linesInBox(linesFrom(text.items), box);
  if (!lines.length) return null;
  const edits = useDocumentStore.getState().edits.filter((e) => e.pageEntryId === entry.id && e.kind === "line");
  const open: OpenLine[] = lines.map((line) => {
    const existing: Edit | undefined = edits.find((e) => overlaps(lineFrame(e), line.box));
    return existing ? { line, runs: runsFromEdit(existing), existing } : { line, runs: runsFor(line, text.page, text.styles, colors.text) };
  });
  return { entry, source, box, lines: open, background: colors.background };
}
```

- [ ] **Step 4: Implement `src/components/DragBox.tsx`**

```tsx
import { useRef, useState } from "react";
import type { Box } from "../pdf/types";

const CLICK_PX = 3;
type Pt = { x: number; y: number };

export function useDragBox(onSelect: (box: Box | null, click: Pt) => void, toPage: (clientX: number, clientY: number) => Pt) {
  const start = useRef<{ client: Pt; page: Pt } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const boxFrom = (a: Pt, b: Pt): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      start.current = { client: { x: e.clientX, y: e.clientY }, page: toPage(e.clientX, e.clientY) };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s) return;
      if (Math.hypot(e.clientX - s.client.x, e.clientY - s.client.y) < CLICK_PX) return;
      setBox(boxFrom(s.page, toPage(e.clientX, e.clientY)));
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s) return;
      start.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const moved = Math.hypot(e.clientX - s.client.x, e.clientY - s.client.y) >= CLICK_PX;
      setBox(null);
      onSelect(moved ? boxFrom(s.page, toPage(e.clientX, e.clientY)) : null, s.page);
    },
  };
  return { handlers, box };
}

export default function DragBox({ box, scale, heightPt }: { box: Box | null; scale: number; heightPt: number }) {
  if (!box) return null;
  return <div className="drag-box" data-testid="drag-box" style={{ left: box.x * scale, top: (heightPt - box.y - box.height) * scale, width: box.width * scale, height: box.height * scale }} />;
}
```

- [ ] **Step 5: Wire PageView** (`src/components/PageView.tsx`)

1. `pageBlocks` result gains `lines`: in `src/edit/pageBlocks.ts` compute `const lines = linesFrom(items)` and return `{ blocks: blocksFrom(lines), lines, styles, page, items }` (add `items` too); update `PageBlocks` type.
2. State: `const [openLines, setOpenLines] = useState<OpenLines | null>(null);` beside `open`.
3. Replace the `onClick` edit branch with pointer handlers on the page element when `tool === "edit"`: `const drag = useDragBox(onEditSelect(entry, source), (cx, cy) => pointAt(pageEl, cx, cy, scale, meta.heightPt))` must be per page, so make a small `EditTargetLayer` component rendered inside each page (`position: absolute; inset: 0`) that owns the hook and renders `<DragBox>`; it receives `entry`, `source`, `scale`, `meta`, and an `onSelect(box | null, pt)` callback from PageView. Keep `.annotationOverlay, .notePopover, .line-editor, .block-editor-wrap, .edit-handles` excluded via a `closest` check in `onPointerDown`.
4. `onEditSelect`: rotation check as today (message unchanged). Click (`box === null`): if an existing edit's `lineFrame`/boxes contain the point → legacy block edit: existing select-then-reopen flow via `openFromEdit` + `BlockEditor`; line edit: `openLinesIn(text, source, entry, lineFrame(edit), colors)`; otherwise `lineAt(lines, pt.x, pt.y)` → `openLinesIn(text, source, entry, line.box, colors)`; nothing → `setMessage("No text here to edit")`. Drag: `openLinesIn(text, source, entry, box, colors)`; null → the same message. `colors` from `sampleBlockColors(canvas, box, scale, meta.heightPt)` as today (`text` colour used for new runs).
5. Render `<LineEditor>` when `openLines?.entry.id === entry.id`, with `key` = the box coordinates joined; keep rendering `<BlockEditor>` for `open` (legacy reopen only).
6. Hover hint: `resolveBlock` for hover now uses `lineAt(lines, …)` and highlights `line.box`; remove the block-based hover.
7. Remove `blockAt`/`blocksFrom` usage from PageView's new-edit path (imports cleaned); `pageBlocks` still exposes `blocks` for `blockFromEdit` consumers.

- [ ] **Step 6: Run everything**

Run: `npx vitest run && npx tsc -b` — Expected: pass. `src/components/BlockHint.test.tsx` and `BlockEditor.test.tsx` must still pass (BlockEditor stays for legacy edits).

- [ ] **Step 7: Commit**

```bash
git add src/edit/openLines.ts src/edit/openLines.test.ts src/edit/pageBlocks.ts src/components/DragBox.tsx src/components/DragBox.test.tsx src/components/PageView.tsx
git commit -m "feat(edit): drag a box or click a line to open the line editor"
```

---

### Task 8: Fixture, end-to-end test, README

**Files:**
- Modify: `scripts/make-fixtures.ts` (add `columns.pdf`), `README.md` ("Edit text" paragraph)
- Create: `src/test/fixtures/columns.pdf` (generated), `e2e/lines.spec.ts`
- Modify: `e2e/edit.spec.ts` (the typed-page test now goes through the line editor: replace `block-editor` with `line-field` and the select-all/type with setting the run's text)

**Interfaces:**
- Consumes: everything above; test IDs from Global Constraints.

- [ ] **Step 1: Fixture generator** (append to `scripts/make-fixtures.ts` before the `await make(...)` calls, and call it)

```ts
async function makeColumns() {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 400]);
  const rows = [["Assigned Caregiver", "Rylee Lyons", "Respiration", "16"], ["Prior Caregiver", "Rylee Lyons", "Temperature", "97.8"], ["Ambulance Called", "No", "Pulse", "78"]];
  rows.forEach((r, i) => {
    const y = 340 - i * 18;
    page.drawText(r[0], { x: 30, y, size: 11, font: bold });
    page.drawText(r[1], { x: 180, y, size: 11, font: reg });
    page.drawText(r[2], { x: 380, y, size: 11, font: bold });
    page.drawText(r[3], { x: 500, y, size: 11, font: reg });
  });
  writeFileSync(join(outDir, "columns.pdf"), await doc.save());
}
await makeColumns();
```
Run: `npm run fixtures` and commit `src/test/fixtures/columns.pdf`.

- [ ] **Step 2: Write the e2e test**

```ts
// e2e/lines.spec.ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });

test("drag a box over the left column, change one value, keep the bold label and the right column", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles('input[type="file"]', fixture("columns"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tool-edit").click();
  const label = page.locator(".page").first().locator(".textLayer span", { hasText: "Assigned Caregiver" });
  const value = page.locator(".page").first().locator(".textLayer span", { hasText: "Rylee Lyons" }).first();
  const lb = (await label.boundingBox())!, vb = (await value.boundingBox())!;
  // Drag from above-left of the label to below-right of the value: covers the two left columns of row 1 only.
  await page.mouse.move(lb.x - 6, lb.y - 4);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width + 6, vb.y + vb.height + 4, { steps: 5 });
  await expect(page.getByTestId("drag-box")).toBeVisible();
  await page.mouse.up();
  const fields = page.getByTestId("line-field");
  await expect(fields).toHaveCount(1);
  const field = fields.first();
  const spans = field.locator("[data-run]");
  await expect(spans).toHaveCount(2);
  await expect(spans.nth(0)).toHaveText("Assigned Caregiver");
  await spans.nth(1).evaluate((el) => { el.textContent = "Jamie Lee"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.getByTestId("line-done").click();
  const lines = page.locator(".edit-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveText("Assigned Caregiver");
  await expect(lines.nth(0)).toHaveCSS("font-weight", "700");
  await expect(lines.nth(1)).toHaveText("Jamie Lee");
  // Right column untouched.
  await expect(page.locator(".page").first().locator(".textLayer span", { hasText: "Respiration" })).toBeVisible();
  // Export: bold face embedded, new value present, old value gone from every stream.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = new Uint8Array(readFileSync((await download.path()) as string));
  const { openPdf } = await import("../src/test/pdfjs");
  const pdf = await openPdf(bytes);
  const tc = await (await pdf.getPage(1)).getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(text).toContain("Jamie Lee");
  expect(text).toContain("Respiration");
  expect(text).not.toContain("Rylee Lyons Respiration");
  const { PDFDocument, PDFRawStream, decodePDFRawStream, PDFName, PDFDict } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  const fonts = doc.getPages()[0].node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
  const names = fonts ? [...fonts.entries()].map(([, v]) => String((v as PDFDict).get?.(PDFName.of("BaseFont")) ?? v)) : [];
  expect(names.join(" ")).toMatch(/Helvetica-Bold/);
  let all = "";
  for (const [, o] of doc.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) all += new TextDecoder("latin1").decode(decodePDFRawStream(o).decode()) + "\n";
  const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
  expect(all.includes("Jamie Lee") || all.toUpperCase().includes(hex("Jamie Lee"))).toBe(true);
});
```
Note: the exported page is flattened (raster + redrawn runs), so the pdf-lib font lookup must be done on the page the exporter produced; if the fonts live in a form XObject or the page's resources differ, adjust the lookup to walk `doc.context.enumerateIndirectObjects()` for dicts whose `BaseFont` is `Helvetica-Bold`.

- [ ] **Step 3: Update `e2e/edit.spec.ts`**

In "edit a typed line in place and download": after the click, replace the `block-editor` expectations with
```ts
  const field = page.getByTestId("line-field").first();
  await expect(field).toHaveText("three:0");
  await field.locator("[data-run]").first().evaluate((el) => { el.textContent = "three:9"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await field.press("Enter");
```
and keep the rest. Apply the same change to the scan test in that file (OCR items produce one run).

- [ ] **Step 4: README**

In the "Edit text" paragraph, replace the sentence about clicking a block with: "In the Edit tool, drag a box over the text you want to change (or click a single line). Each line in the box becomes its own field, pre-styled with its original bold, regular, and italic runs and sizes; type inside a run and the new text keeps that run's style. Press Enter or Done and only the lines you changed are replaced, drawn in matching standard faces over a cover in the page's own colour; everything else on the page is untouched. Emptying a field whites the line out."

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npx tsc -b && npx playwright test e2e/lines.spec.ts e2e/edit.spec.ts --reporter=line`
Expected: all green (the scan part of `edit.spec.ts` is gated by `E2E_OCR`).

- [ ] **Step 6: Commit**

```bash
git add scripts/make-fixtures.ts src/test/fixtures/columns.pdf e2e/lines.spec.ts e2e/edit.spec.ts README.md
git commit -m "test(edit): two-column fixture and line-editing e2e; README"
```
