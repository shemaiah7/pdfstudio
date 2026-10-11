# In-place Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click any text block on a typed or OCR'd page, edit it in place with a matched standard font and sampled colours, and have the result show on screen, in extracted text (AI + search), in the OCR store for scans, and in the downloaded PDF.

**Architecture:** Pure modules under `src/edit/` (block detection, font matching, colour sampling, block layout) feed a `BlockEditor` component driven by a new `edit` tool. Edits stay the existing `Edit` records (boxes + text + font + colours), extended with background colour, line height, source, and a block key. `extractPageText` overlays edits onto extracted items; the OCR store is rewritten for scan blocks; export draws covers and text with pdf-lib's 12 standard faces.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 5 (jsdom for components), pdfjs-dist 6.4 (`page.commonObjs` font flags), pdf-lib (StandardFonts), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-text-editing-design.md`

## Global Constraints

- `EditFont` is exactly the 12 faces `helvetica`, `helvetica-bold`, `helvetica-oblique`, `helvetica-boldoblique`, `times`, `times-bold`, `times-italic`, `times-bolditalic`, `courier`, `courier-bold`, `courier-oblique`, `courier-boldoblique`; legacy `sans` → `helvetica`, `sans-bold` → `helvetica-bold`, `serif` → `times` via `normalizeFont`.
- Boxes stay crop-relative PDF points, bottom-left origin (existing convention); export adds `ox, oy`.
- Block detection: baseline grouping `|Δy| ≤ 0.5·fontSize`; paragraph join when `|Δleft| ≤ 0.5·fontSize`, `0 < gap ≤ 1.6·fontSize` (gap = baseline distance minus fontSize), same `fontName`, `|ΔfontSize| ≤ 10 %`; single-line block `lineHeight = 1.2·fontSize`; `blockAt` tolerance 2 pt.
- Font match rules (in order): monospace flag or `/courier|mono/i` → Courier; serif flag or `/times|georgia|garamond|book|roman|serif/i` and not `/sans/i` → Times; else Helvetica; bold when flag, `cssWeight ≥ 600`, or `/bold|black|heavy|semibold/i`; italic when flag, `cssStyle === "italic"`, or `/italic|oblique/i`; `fontName === "ocr"` → `helvetica`.
- Colour sampling: ring 3 px, background = most frequent colour quantised to 16 levels/channel in the ring, text = mean of the darkest 5 % inside; fallback white/black.
- Copy, verbatim: tool label `Edit text`, `data-testid="tool-edit"`, key `e`; messages `No text here.`, `Block too narrow to edit.`, `Rotate the page back to its original orientation to edit text.`; hint `Fits` / `Overflows by {N} line(s)`; `Some characters cannot be saved in this font`; buttons `Done`, `Cancel`, `Delete`.
- Editing allowed only when `(pageRotate + entry.rotation) % 360 === 0`.
- `npx tsc -b`, `npm test`, `npm run lint` (0 errors), `npx playwright test` must pass after every task. Never commit `.env` or `worker/.dev.vars`; never stage `.superpowers/`.

## Review Focus

1. A click on a block whose text-layer spans are hidden by an existing edit must reopen that edit, not create a second one on top. Test in Task 8 (click inside an edit's boxes → reopen with the edit's text).
2. Editing a block on a page with a non-zero crop origin must place cover and text where the original was (boxes crop-relative; export adds the origin). Test in Task 1 (export on `offset.pdf` places text at the box + origin).
3. Fast typing before the pdf-lib measurer has loaded must not lay out with CSS metrics then jump. Test in Task 7 (editor does not open until the measurer resolves; opens afterwards).
4. Undo after Apply must remove the edit and restore the hidden spans. Test in Task 8 (undo → spans visible again).
5. A scan edited after Deep OCR must keep the Claude engine tag on the OCR page and only replace words inside the block. Test in Task 6 (`engine` unchanged, words outside the block unchanged).

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/pdf/types.ts` | `EditFont` (12), `LegacyEditFont`, extended `Edit`. |
| `src/pdf/fonts.ts` | `normalizeFont`, `STANDARD_FONTS` map (EditFont → pdf-lib StandardFonts), `FONT_CSS` map. |
| `src/pdf/metrics.ts`, `src/pdf/pageOps.ts`, `src/components/EditOverlay.tsx` | Use the 12 faces, cover colour, text colour. |
| `src/store/document.ts` | `addEdit` normalises + replaces by `blockKey`; `updateEdit`. |
| `src/pdf/text.ts` | `TextItemBox.fontName`; edits overlay in `extractPageText`; cache invalidation on edits change; `editsStamp(sourceId)`. |
| `src/edit/blocks.ts` | `linesFrom`, `blocksFrom`, `blockAt`. |
| `src/edit/fontMatch.ts`, `src/edit/fontInfo.ts` | `matchFont`, `fontInfoFor(page, fontName, styles)`. |
| `src/edit/colors.ts` | `sampleColors(imageData, rect)`, `sampleBlockColors(canvas, box, scale, heightPt)`. |
| `src/edit/layout.ts` | `layoutBlock(text, box, fontSize, lineHeight, measure)` → lines + boxes + overflow. |
| `src/store/ocr.ts` | `applyEditToOcr(sourceId, pageIndex, edit, measure)`. |
| `src/search/indexer.ts`, `src/store/search.ts` | content version includes edits stamp; re-index on edits change. |
| `src/components/BlockEditor.tsx` | The in-place editor. |
| `src/components/EditHandles.tsx` | Delete / font menu / drag / width handle for existing edits. |
| `src/components/PageView.tsx`, `TextLayer.tsx`, `ToolPalette.tsx`, `src/store/tools.ts`, `src/styles.css` | Tool, hover outline, click routing, hidden spans, styles. |
| `e2e/edit.spec.ts`, `README.md` | End-to-end and docs. |

---

### Task 1: Twelve standard faces, extended Edit record, normalisation, export colours

**Files:**
- Create: `src/pdf/fonts.ts`, `src/pdf/fonts.test.ts`
- Modify: `src/pdf/types.ts`, `src/pdf/metrics.ts`, `src/pdf/pageOps.ts`, `src/pdf/pageOps.test.ts` (append), `src/components/EditOverlay.tsx`, `src/components/ai/RewriteTab.tsx` (no behaviour change; passes legacy names still), `src/store/document.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/pdf/types.ts
  export type EditFont = "helvetica" | "helvetica-bold" | "helvetica-oblique" | "helvetica-boldoblique" | "times" | "times-bold" | "times-italic" | "times-bolditalic" | "courier" | "courier-bold" | "courier-oblique" | "courier-boldoblique";
  export type LegacyEditFont = "sans" | "sans-bold" | "serif";
  export interface Edit { id: string; pageEntryId: string; boxes: Box[]; text: string; fontSize: number; font: EditFont; color: RGB; background?: RGB; lineHeight?: number; source?: "native" | "ocr"; blockKey?: string }
  // src/pdf/fonts.ts
  export const EDIT_FONTS: readonly EditFont[];
  export function normalizeFont(f: EditFont | LegacyEditFont | string): EditFont;   // unknown → "helvetica"
  export const STANDARD_FONTS: Record<EditFont, StandardFonts>;
  export const FONT_CSS: Record<EditFont, string>;   // e.g. "700 1px Helvetica, Arial, sans-serif", italic variants prefixed "italic "
  export function fontFamily(f: EditFont): "helvetica" | "times" | "courier";
  // src/store/document.ts
  addEdit(e: Omit<Edit, "id"> & { font: EditFont | LegacyEditFont }): string;   // normalises font; if e.blockKey matches an existing edit on the same page, replaces it (same id)
  updateEdit(id: string, patch: Partial<Omit<Edit, "id" | "pageEntryId">>): void;
  ```
- Export draws `background ?? [1,1,1]` as the cover colour and the text in `STANDARD_FONTS[normalizeFont(e.font)]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/pdf/fonts.test.ts
import { describe, it, expect } from "vitest";
import { StandardFonts } from "pdf-lib";
import { EDIT_FONTS, normalizeFont, STANDARD_FONTS, FONT_CSS, fontFamily } from "./fonts";

describe("fonts", () => {
  it("lists the 12 standard faces and maps each to pdf-lib", () => {
    expect(EDIT_FONTS).toHaveLength(12);
    expect(STANDARD_FONTS["courier-boldoblique"]).toBe(StandardFonts.CourierBoldOblique);
    expect(STANDARD_FONTS["times-bolditalic"]).toBe(StandardFonts.TimesRomanBoldItalic);
    expect(STANDARD_FONTS["helvetica"]).toBe(StandardFonts.Helvetica);
  });
  it("normalises legacy names and unknowns", () => {
    expect(normalizeFont("sans")).toBe("helvetica");
    expect(normalizeFont("sans-bold")).toBe("helvetica-bold");
    expect(normalizeFont("serif")).toBe("times");
    expect(normalizeFont("times-italic")).toBe("times-italic");
    expect(normalizeFont("nope")).toBe("helvetica");
  });
  it("builds CSS with weight and style", () => {
    expect(FONT_CSS["helvetica-boldoblique"]).toBe("italic 700 1px Helvetica, Arial, sans-serif");
    expect(FONT_CSS["courier"]).toBe("400 1px 'Courier New', Courier, monospace");
    expect(fontFamily("times-bold")).toBe("times");
  });
});
```

Append to `src/pdf/pageOps.test.ts` (it already loads fixtures and parses output with pdf.js; follow its helpers):

```ts
it("draws an edit with a courier-bold face, a coloured cover, and the crop origin offset", async () => {
  const bytes = loadFixture("offset");            // crop box origin (50,100)
  const sources = new Map([["s", { id: "s", name: "offset.pdf", bytes, pageCount: 1 }]]);
  const pages = [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const }];
  const out = await buildDocument(sources, pages, [{ id: "e", pageEntryId: "p", boxes: [{ x: 20, y: 300, width: 120, height: 14 }], text: "Dose 10 mg", fontSize: 11, font: "courier-bold", color: [0, 0, 1], background: [1, 1, 0.8], lineHeight: 13, source: "native" }]);
  const pdf = await getDocument({ data: out.slice() }).promise;
  const page = await pdf.getPage(1);
  const items = (await page.getTextContent()).items.filter((i): i is typeof i & { str: string; transform: number[] } => "str" in i);
  const hit = items.find((i) => i.str.includes("Dose"));
  expect(hit).toBeDefined();
  expect(hit!.transform[4]).toBeCloseTo(20 + 50, 0);
  const raw = new TextDecoder("latin1").decode(out);
  expect(raw).toMatch(/Courier-Bold/);
  expect(raw).toMatch(/1 1 0\.8 rg/);
});
it("still accepts legacy font names from the AI insert", async () => {
  const bytes = loadFixture("three");
  const sources = new Map([["s", { id: "s", name: "three.pdf", bytes, pageCount: 1 }]]);
  const pages = [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const }];
  await expect(buildDocument(sources, pages, [{ id: "e", pageEntryId: "p", boxes: [{ x: 20, y: 300, width: 120, height: 14 }], text: "x", fontSize: 11, font: "sans-bold" as never, color: [0, 0, 0] }])).resolves.toBeInstanceOf(Uint8Array);
});
```

And in `src/store/document.test.ts` append:

```ts
it("addEdit normalises the font and replaces an edit with the same blockKey; updateEdit patches", async () => {
  await s().openFiles([three()]);
  const p = s().pages[0].id;
  const a = s().addEdit({ pageEntryId: p, boxes: [{ x: 0, y: 0, width: 10, height: 10 }], text: "a", fontSize: 10, font: "sans", color: [0, 0, 0], blockKey: "k" });
  expect(s().edits[0].font).toBe("helvetica");
  const b = s().addEdit({ pageEntryId: p, boxes: [{ x: 0, y: 0, width: 10, height: 10 }], text: "b", fontSize: 10, font: "times", color: [0, 0, 0], blockKey: "k" });
  expect(b).toBe(a);
  expect(s().edits).toHaveLength(1);
  expect(s().edits[0].text).toBe("b");
  s().updateEdit(a, { font: "courier", text: "c" });
  expect(s().edits[0]).toMatchObject({ font: "courier", text: "c" });
  s().undo();
  expect(s().edits[0].text).toBe("b");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pdf/fonts.test.ts src/pdf/pageOps.test.ts src/store/document.test.ts`
Expected: FAIL (module missing; `updateEdit` undefined; raw PDF lacks Courier-Bold).

- [ ] **Step 3: Implement**

```ts
// src/pdf/fonts.ts
import { StandardFonts } from "pdf-lib";
import type { EditFont, LegacyEditFont } from "./types";

export const EDIT_FONTS = ["helvetica", "helvetica-bold", "helvetica-oblique", "helvetica-boldoblique", "times", "times-bold", "times-italic", "times-bolditalic", "courier", "courier-bold", "courier-oblique", "courier-boldoblique"] as const satisfies readonly EditFont[];
const LEGACY: Record<LegacyEditFont, EditFont> = { sans: "helvetica", "sans-bold": "helvetica-bold", serif: "times" };
export function normalizeFont(f: EditFont | LegacyEditFont | string): EditFont {
  if ((EDIT_FONTS as readonly string[]).includes(f)) return f as EditFont;
  return LEGACY[f as LegacyEditFont] ?? "helvetica";
}
export const STANDARD_FONTS: Record<EditFont, StandardFonts> = {
  helvetica: StandardFonts.Helvetica, "helvetica-bold": StandardFonts.HelveticaBold, "helvetica-oblique": StandardFonts.HelveticaOblique, "helvetica-boldoblique": StandardFonts.HelveticaBoldOblique,
  times: StandardFonts.TimesRoman, "times-bold": StandardFonts.TimesRomanBold, "times-italic": StandardFonts.TimesRomanItalic, "times-bolditalic": StandardFonts.TimesRomanBoldItalic,
  courier: StandardFonts.Courier, "courier-bold": StandardFonts.CourierBold, "courier-oblique": StandardFonts.CourierOblique, "courier-boldoblique": StandardFonts.CourierBoldOblique,
};
const FAMILY_CSS = { helvetica: "Helvetica, Arial, sans-serif", times: "'Times New Roman', Times, serif", courier: "'Courier New', Courier, monospace" } as const;
export function fontFamily(f: EditFont): "helvetica" | "times" | "courier" { return f.split("-")[0] as "helvetica" | "times" | "courier"; }
export const FONT_CSS = Object.fromEntries(EDIT_FONTS.map((f) => {
  const bold = /bold/.test(f), italic = /italic|oblique/.test(f);
  return [f, `${italic ? "italic " : ""}${bold ? 700 : 400} 1px ${FAMILY_CSS[fontFamily(f)]}`];
})) as Record<EditFont, string>;
```

`src/pdf/types.ts`: replace the `EditFont` line and `Edit` interface with the Interfaces block above (keep `RGB` import order).

`src/pdf/metrics.ts`: replace `STANDARD` with `STANDARD_FONTS` from `./fonts`; `loadFonts` embeds lazily per face: keep a `Map<EditFont, Promise<PDFFont>>` and `measureFor(font)` normalises first (`normalizeFont`). (Embedding all 12 up front is fine too but lazy keeps startup cheap.)

`src/pdf/pageOps.ts`: in the edits block, replace the three-font object with a per-document cache `const fontCache = new Map<EditFont, PDFFont>()` and `const fontFor = async (f) => fontCache.get(f) ?? (fontCache.set(f, await out.embedFont(STANDARD_FONTS[f])), fontCache.get(f)!)`; `const face = normalizeFont(e.font); const font = await fontFor(face);` cover colour `rgb(...(e.background ?? [1, 1, 1]))`.

`src/components/EditOverlay.tsx`: import `FONT_CSS`, `normalizeFont` from `../pdf/fonts`; use `FONT_CSS[normalizeFont(e.font)]`; `.edit-box` gets `background: rgb(...)` from `e.background ?? [1,1,1]`; `usePdfMeasure(edits.map((e) => normalizeFont(e.font)))`.

`src/store/document.ts`:

```ts
addEdit(e) {
  const font = normalizeFont(e.font);
  const existing = e.blockKey ? get().edits.find((x) => x.pageEntryId === e.pageEntryId && x.blockKey === e.blockKey) : undefined;
  if (existing) { commit({ edits: get().edits.map((x) => (x.id === existing.id ? { ...e, font, id: existing.id } : x)) }); return existing.id; }
  const id = nextId("ed");
  commit({ edits: [...get().edits, { ...e, font, id }] });
  return id;
},
updateEdit(id, patch) {
  commit({ edits: get().edits.map((x) => (x.id === id ? { ...x, ...patch, ...(patch.font ? { font: normalizeFont(patch.font) } : {}) } : x)) });
},
```

Add `updateEdit` to `DocumentState`. `usePdfMeasure` keeps its signature (EditFont keys).

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src && npx tsc -b && npm run lint`
Expected: PASS (RewriteTab still passes `sans`/`sans-bold`/`serif`; `addEdit` accepts them).

- [ ] **Step 5: Commit**

```bash
git add src/pdf/fonts.ts src/pdf/fonts.test.ts src/pdf/types.ts src/pdf/metrics.ts src/pdf/pageOps.ts src/pdf/pageOps.test.ts src/components/EditOverlay.tsx src/store/document.ts src/store/document.test.ts
git commit -m "feat(edit): twelve standard faces, cover colour, blockKey replace, updateEdit"
```

---

### Task 2: Block detection

**Files:**
- Create: `src/edit/blocks.ts`, `src/edit/blocks.test.ts`
- Modify: `src/pdf/text.ts` (`TextItemBox.fontName`), `src/ocr/layout.ts` (`ocrPageToItems` sets `fontName: "ocr"`)

**Interfaces:**
- Produces:
  ```ts
  // src/pdf/text.ts
  export interface TextItemBox { str: string; x: number; y: number; width: number; height: number; fontSize: number; fontName: string }
  // src/edit/blocks.ts
  export interface TextLine { text: string; x: number; baseline: number; width: number; fontSize: number; fontName: string; items: TextItemBox[] }
  export interface TextBlock { lines: TextLine[]; box: Box; lineHeight: number; fontSize: number; fontName: string; text: string; firstLineIndex: number }
  export function linesFrom(items: TextItemBox[]): TextLine[]
  export function blocksFrom(lines: TextLine[]): TextBlock[]
  export function blockAt(blocks: TextBlock[], x: number, y: number): TextBlock | undefined
  export function blockKeyOf(sourceId: string, pageIndex: number, block: TextBlock): string   // `${sourceId}:${pageIndex}:${block.firstLineIndex}`
  ```
  Line `x` = min item x; `width` = max(x+width) − x; `text` = items sorted by x joined with a space when the gap > 0.15·fontSize (same rule as `linesFromItems`). Block `box` = { x: min line x, y: lowest baseline − 0.25·fontSize, width: max line right − x, height: top baseline + fontSize − y } where top/bottom use the first/last line baselines. `lineHeight` = mean baseline distance for ≥ 2 lines, else 1.2·fontSize. Lines sorted top to bottom (descending baseline); `firstLineIndex` is the index in the sorted line list.

- [ ] **Step 1: Write the failing tests**

```ts
// src/edit/blocks.test.ts
import { describe, it, expect } from "vitest";
import { linesFrom, blocksFrom, blockAt, blockKeyOf } from "./blocks";
import type { TextItemBox } from "../pdf/text";

const it_ = (str: string, x: number, y: number, w: number, size = 10, fontName = "f1"): TextItemBox => ({ str, x, y, width: w, height: size, fontSize: size, fontName });

describe("linesFrom", () => {
  it("groups by baseline within half the font size and joins with spaces by gap", () => {
    const lines = linesFrom([it_("world", 60, 700, 30), it_("Hello", 10, 702, 40), it_("Next", 10, 686, 30)]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world", "Next"]);
    expect(lines[0]).toMatchObject({ x: 10, baseline: 700, width: 80 });
  });
});

describe("blocksFrom", () => {
  const para = (y0: number, n: number, x = 10, fontName = "f1", size = 10) => Array.from({ length: n }, (_, i) => it_(`l${y0}-${i}`, x, y0 - i * 12, 100, size, fontName));
  it("joins consecutive lines with the same left edge, small gap, same font", () => {
    const blocks = blocksFrom(linesFrom([...para(700, 3)]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(3);
    expect(blocks[0].lineHeight).toBeCloseTo(12);
    expect(blocks[0].text).toBe("l700-0\nl700-1\nl700-2");
    expect(blocks[0].box).toMatchObject({ x: 10, width: 100 });
    expect(blocks[0].box.y).toBeCloseTo(700 - 24 - 2.5);
    expect(blocks[0].box.height).toBeCloseTo(24 + 2.5 + 10);
  });
  it("splits on a large gap, a different left edge, or a different font", () => {
    const items = [...para(700, 2), ...para(640, 2), ...para(600, 2, 40), ...para(560, 2, 10, "f2")];
    const blocks = blocksFrom(linesFrom(items));
    expect(blocks.map((b) => b.lines.length)).toEqual([2, 2, 2, 2]);
    expect(blocks[1].firstLineIndex).toBe(2);
  });
  it("splits when the font size differs by more than 10 %", () => {
    const blocks = blocksFrom(linesFrom([it_("big", 10, 700, 50, 20), it_("small", 10, 676, 50, 10)]));
    expect(blocks).toHaveLength(2);
    expect(blocks[1].lineHeight).toBeCloseTo(12);
  });
  it("forms blocks from OCR items", () => {
    const blocks = blocksFrom(linesFrom([it_("Patient", 36, 350, 40, 14, "ocr"), it_("Jane", 80, 350, 30, 14, "ocr"), it_("Dx", 36, 336, 20, 14, "ocr")]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fontName).toBe("ocr");
    expect(blocks[0].text).toBe("Patient Jane\nDx");
  });
});

describe("blockAt / blockKeyOf", () => {
  it("finds the block containing a point with 2pt tolerance", () => {
    const blocks = blocksFrom(linesFrom([it_("a", 10, 700, 100), it_("b", 10, 600, 100)]));
    expect(blockAt(blocks, 50, 705)?.text).toBe("a");
    expect(blockAt(blocks, 111.5, 600)?.text).toBe("b");
    expect(blockAt(blocks, 50, 650)).toBeUndefined();
    expect(blockKeyOf("s", 2, blocks[1])).toBe("s:2:1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/edit/blocks.test.ts`
Expected: FAIL, cannot resolve `./blocks`.

- [ ] **Step 3: Implement**

```ts
// src/edit/blocks.ts
import type { Box } from "../pdf/types";
import type { TextItemBox } from "../pdf/text";

export interface TextLine { text: string; x: number; baseline: number; width: number; fontSize: number; fontName: string; items: TextItemBox[] }
export interface TextBlock { lines: TextLine[]; box: Box; lineHeight: number; fontSize: number; fontName: string; text: string; firstLineIndex: number }

export function linesFrom(items: TextItemBox[]): TextLine[] {
  const placed = items.filter((i) => i.str.length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItemBox[][] = [];
  for (const p of placed) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - p.y) <= g[0].fontSize * 0.5) g.push(p); else groups.push([p]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let text = "", cursor = -Infinity;
    for (const p of g) {
      const gap = p.x - cursor;
      if (text && gap > p.fontSize * 0.15 && !text.endsWith(" ") && !p.str.startsWith(" ")) text += " ";
      text += p.str; cursor = p.x + p.width;
    }
    const x = Math.min(...g.map((i) => i.x));
    const right = Math.max(...g.map((i) => i.x + i.width));
    return { text: text.replace(/\s+/g, " ").trim(), x, baseline: g[0].y, width: right - x, fontSize: g[0].fontSize, fontName: g[0].fontName, items: g };
  });
}

function joins(a: TextLine, b: TextLine): boolean {
  const gap = a.baseline - b.baseline - a.fontSize;
  return Math.abs(a.x - b.x) <= a.fontSize * 0.5 && gap > 0 && gap <= a.fontSize * 1.6 && a.fontName === b.fontName && Math.abs(a.fontSize - b.fontSize) <= a.fontSize * 0.1;
}

export function blocksFrom(lines: TextLine[]): TextBlock[] {
  const out: TextBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const group = [lines[i]];
    let j = i + 1;
    while (j < lines.length && joins(group[group.length - 1], lines[j])) group.push(lines[j++]);
    const fontSize = group[0].fontSize;
    const lineHeight = group.length > 1 ? (group[0].baseline - group[group.length - 1].baseline) / (group.length - 1) : fontSize * 1.2;
    const x = Math.min(...group.map((l) => l.x));
    const right = Math.max(...group.map((l) => l.x + l.width));
    const y = group[group.length - 1].baseline - fontSize * 0.25;
    const top = group[0].baseline + fontSize;
    out.push({ lines: group, box: { x, y, width: right - x, height: top - y }, lineHeight, fontSize, fontName: group[0].fontName, text: group.map((l) => l.text).join("\n"), firstLineIndex: i });
    i = j;
  }
  return out;
}

export function blockAt(blocks: TextBlock[], x: number, y: number, tol = 2): TextBlock | undefined {
  return blocks.find((b) => x >= b.box.x - tol && x <= b.box.x + b.box.width + tol && y >= b.box.y - tol && y <= b.box.y + b.box.height + tol);
}

export function blockKeyOf(sourceId: string, pageIndex: number, block: TextBlock): string { return `${sourceId}:${pageIndex}:${block.firstLineIndex}`; }
```

`src/pdf/text.ts`: add `fontName: string` to `TextItemBox`; in `extractPageText` map `fontName: (i as { fontName?: string }).fontName ?? ""` (pdf.js items carry `fontName`; extend `RawItem` with `fontName?: string`). `src/ocr/layout.ts` `ocrPageToItems`: add `fontName: "ocr"`. Fix any test fixtures that build `TextItemBox` literals (add `fontName`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src && npx tsc -b && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edit/blocks.ts src/edit/blocks.test.ts src/pdf/text.ts src/ocr/layout.ts
git commit -m "feat(edit): paragraph block detection from text items"
```

---

### Task 3: Font matching and pdf.js font info

**Files:**
- Create: `src/edit/fontMatch.ts`, `src/edit/fontMatch.test.ts`, `src/edit/fontInfo.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FontInfo { name?: string; serif?: boolean; monospace?: boolean; bold?: boolean; italic?: boolean; cssFamily?: string; cssWeight?: number; cssStyle?: string }
  export function matchFont(info: FontInfo): EditFont
  // src/edit/fontInfo.ts
  export function fontInfoFor(page: { commonObjs: { has(id: string): boolean; get(id: string): unknown } }, fontName: string, styles: Record<string, { fontFamily?: string }>): FontInfo
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/edit/fontMatch.test.ts
import { describe, it, expect } from "vitest";
import { matchFont } from "./fontMatch";
import { fontInfoFor } from "./fontInfo";

describe("matchFont", () => {
  it.each([
    [{ name: "ABCDEF+Arial-BoldMT" }, "helvetica-bold"],
    [{ name: "TimesNewRomanPS-ItalicMT" }, "times-italic"],
    [{ name: "Georgia-BoldItalic" }, "times-bolditalic"],
    [{ name: "CourierNewPSMT" }, "courier"],
    [{ name: "Consolas" , monospace: true, bold: true }, "courier-bold"],
    [{ name: "OpenSans-SemiBold" }, "helvetica-bold"],
    [{ name: "Calibri", serif: true }, "times"],
    [{ cssFamily: "serif", cssWeight: 700, cssStyle: "italic" }, "times-bolditalic"],
    [{ cssFamily: "sans-serif", cssWeight: 400 }, "helvetica"],
    [{ name: "LiberationSans-Oblique" }, "helvetica-oblique"],
    [{ name: "Garamond-Black" }, "times-bold"],
    [{}, "helvetica"],
  ])("matches %j → %s", (info, expected) => { expect(matchFont(info)).toBe(expected); });
  it("maps OCR items to helvetica regardless of flags", () => {
    expect(matchFont({ name: "ocr", serif: true, bold: true })).toBe("helvetica");
  });
});

describe("fontInfoFor", () => {
  it("reads flags from a loaded pdf.js font object", () => {
    const page = { commonObjs: { has: () => true, get: () => ({ name: "Foo-Bold", isSerifFont: true, isMonospace: false, bold: true, italic: false, black: false }) } };
    expect(fontInfoFor(page, "g_d0_f1", {})).toEqual({ name: "Foo-Bold", serif: true, monospace: false, bold: true, italic: false });
  });
  it("falls back to the text-layer style family when the font is not loaded", () => {
    const page = { commonObjs: { has: () => false, get: () => { throw new Error("not loaded"); } } };
    expect(fontInfoFor(page, "g_d0_f1", { g_d0_f1: { fontFamily: "monospace" } })).toEqual({ cssFamily: "monospace" });
  });
  it("returns the ocr name for OCR items", () => {
    expect(fontInfoFor({ commonObjs: { has: () => false, get: () => null } }, "ocr", {})).toEqual({ name: "ocr" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/edit/fontMatch.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

```ts
// src/edit/fontMatch.ts
import type { EditFont } from "../pdf/types";
export interface FontInfo { name?: string; serif?: boolean; monospace?: boolean; bold?: boolean; italic?: boolean; cssFamily?: string; cssWeight?: number; cssStyle?: string }

export function matchFont(info: FontInfo): EditFont {
  if (info.name === "ocr") return "helvetica";
  const hay = `${info.name ?? ""} ${info.cssFamily ?? ""}`;
  const mono = info.monospace || /courier|mono/i.test(hay);
  const serif = !mono && (info.serif || (/times|georgia|garamond|book|roman|serif/i.test(hay) && !/sans/i.test(hay)));
  const family = mono ? "courier" : serif ? "times" : "helvetica";
  const bold = !!info.bold || (info.cssWeight ?? 0) >= 600 || /bold|black|heavy|semibold/i.test(hay);
  const italic = !!info.italic || info.cssStyle === "italic" || /italic|oblique/i.test(hay);
  if (family === "times") return bold && italic ? "times-bolditalic" : bold ? "times-bold" : italic ? "times-italic" : "times";
  const base = family;
  return bold && italic ? `${base}-boldoblique` : bold ? `${base}-bold` : italic ? `${base}-oblique` : base;
}
```

```ts
// src/edit/fontInfo.ts
import type { FontInfo } from "./fontMatch";
interface PdfFontObj { name?: string; isSerifFont?: boolean; isMonospace?: boolean; bold?: boolean; italic?: boolean; black?: boolean }
export function fontInfoFor(page: { commonObjs: { has(id: string): boolean; get(id: string): unknown } }, fontName: string, styles: Record<string, { fontFamily?: string }>): FontInfo {
  if (fontName === "ocr") return { name: "ocr" };
  try {
    if (page.commonObjs.has(fontName)) {
      const f = page.commonObjs.get(fontName) as PdfFontObj | null;
      if (f) return { name: f.name, serif: !!f.isSerifFont, monospace: !!f.isMonospace, bold: !!(f.bold || f.black), italic: !!f.italic };
    }
  } catch { /* fall through */ }
  const fam = styles[fontName]?.fontFamily;
  return fam ? { cssFamily: fam } : {};
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/edit && npx tsc -b && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edit/fontMatch.ts src/edit/fontMatch.test.ts src/edit/fontInfo.ts
git commit -m "feat(edit): match original fonts to the standard faces"
```

---

### Task 4: Colour sampling

**Files:**
- Create: `src/edit/colors.ts`, `src/edit/colors.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PixelRect { x: number; y: number; width: number; height: number }   // pixels, top-left origin
  export function sampleColors(image: ImageData, rect: PixelRect, ring = 3): { background: RGB; text: RGB }
  export function sampleBlockColors(canvas: HTMLCanvasElement, box: Box, scale: number, heightPt: number): { background: RGB; text: RGB }   // DOM: maps a crop-relative box to canvas pixels using canvas.width / (widthPt·scale) as the device ratio; returns white/black on any failure
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/edit/colors.test.ts
import { describe, it, expect } from "vitest";
import { sampleColors } from "./colors";

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

describe("sampleColors", () => {
  it("takes the background from the ring and the text from the darkest pixels inside", () => {
    // cream page, block at 10..40 x 10..20 with navy glyph pixels on a cream background
    const img = image(60, 40, (x, y) => (x >= 12 && x <= 38 && y >= 12 && y <= 18 && (x + y) % 3 === 0 ? [20, 30, 90] : [250, 245, 230]));
    const { background, text } = sampleColors(img, { x: 10, y: 10, width: 30, height: 10 });
    expect(background.map((c) => Math.round(c * 255))).toEqual([250, 245, 230].map((v) => Math.round(v / 16) * 16 + 8).map((v) => Math.min(255, v)));
    expect(text[2]).toBeGreaterThan(text[0]);
    expect(text[0] * 255).toBeLessThan(60);
  });
  it("falls back to white/black when the rect is outside the image", () => {
    const img = image(10, 10, () => [255, 255, 255]);
    expect(sampleColors(img, { x: 50, y: 50, width: 5, height: 5 })).toEqual({ background: [1, 1, 1], text: [0, 0, 0] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/edit/colors.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// src/edit/colors.ts
import type { Box, RGB } from "../pdf/types";
export interface PixelRect { x: number; y: number; width: number; height: number }
const Q = 16;
const WHITE: RGB = [1, 1, 1], BLACK: RGB = [0, 0, 0];

export function sampleColors(image: ImageData, rect: PixelRect, ring = 3): { background: RGB; text: RGB } {
  const { width: W, height: H, data } = image;
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(W, Math.ceil(rect.x + rect.width)), y1 = Math.min(H, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return { background: WHITE, text: BLACK };
  const counts = new Map<number, number>();
  const px = (x: number, y: number) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] as const; };
  for (let y = Math.max(0, y0 - ring); y < Math.min(H, y1 + ring); y++) for (let x = Math.max(0, x0 - ring); x < Math.min(W, x1 + ring); x++) {
    if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
    const [r, g, b] = px(x, y);
    const key = (Math.floor(r / Q) << 8) | (Math.floor(g / Q) << 4) | Math.floor(b / Q);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let background = WHITE;
  if (counts.size) {
    const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    background = [((key >> 8) & 15) * Q + Q / 2, ((key >> 4) & 15) * Q + Q / 2, (key & 15) * Q + Q / 2].map((v) => Math.min(255, v) / 255) as RGB;
  }
  const inside: [number, number, number, number][] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const [r, g, b] = px(x, y); inside.push([r + g + b, r, g, b]); }
  if (!inside.length) return { background, text: BLACK };
  inside.sort((a, b) => a[0] - b[0]);
  const n = Math.max(1, Math.floor(inside.length * 0.05));
  const sum = [0, 0, 0];
  for (const [, r, g, b] of inside.slice(0, n)) { sum[0] += r; sum[1] += g; sum[2] += b; }
  return { background, text: [sum[0] / n / 255, sum[1] / n / 255, sum[2] / n / 255] };
}

export function sampleBlockColors(canvas: HTMLCanvasElement, box: Box, scale: number, heightPt: number): { background: RGB; text: RGB } {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { background: WHITE, text: BLACK };
    const ratio = canvas.width / (parseFloat(canvas.style.width) || canvas.width);
    const rect = { x: box.x * scale * ratio, y: (heightPt - box.y - box.height) * scale * ratio, width: box.width * scale * ratio, height: box.height * scale * ratio };
    const pad = 3 * ratio;
    const img = ctx.getImageData(Math.max(0, rect.x - pad), Math.max(0, rect.y - pad), rect.width + 2 * pad, rect.height + 2 * pad);
    return sampleColors(img, { x: Math.min(pad, rect.x), y: Math.min(pad, rect.y), width: rect.width, height: rect.height }, pad);
  } catch { return { background: WHITE, text: BLACK }; }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/edit && npx tsc -b && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edit/colors.ts src/edit/colors.test.ts
git commit -m "feat(edit): sample cover and text colours from the page bitmap"
```

---

### Task 5: Block layout

**Files:**
- Create: `src/edit/layout.ts`, `src/edit/layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BlockLayout { lines: PlacedLine[]; boxes: Box[]; height: number; overflowLines: number }
  export function layoutBlock(text: string, box: Box, fontSize: number, lineHeight: number, measure: Measure): BlockLayout
  ```
  Wrap at `box.width` (reuse the word/char wrap from `src/pdf/layout.ts`: export its `wrap` as `wrapWords`), breaking on `\n`. Baseline of line k = `box.y + box.height − 0.8·fontSize − k·lineHeight`. One box per line: `{ x: box.x, y: baseline − 0.25·fontSize, width: box.width, height: lineHeight }` (the last line's box height = `fontSize·1.05` so covers do not overshoot). `height` = `lines.length·lineHeight`; `overflowLines` = max(0, lines beyond `floor((box.height + 0.2·lineHeight) / lineHeight)`).

- [ ] **Step 1: Write the failing test**

```ts
// src/edit/layout.test.ts
import { describe, it, expect } from "vitest";
import { layoutBlock } from "./layout";
const measure = (t: string, s: number) => t.length * s * 0.5;

describe("layoutBlock", () => {
  const box = { x: 10, y: 100, width: 100, height: 36 }; // 3 lines of 12
  it("wraps words at the block width and places baselines by lineHeight", () => {
    const l = layoutBlock("aaaa bbbb cccc dddd", box, 10, 12, measure); // 20 chars per line max
    expect(l.lines.map((x) => x.text)).toEqual(["aaaa bbbb cccc dddd"]);
    const l2 = layoutBlock("aaaaaaaaaa bbbbbbbbbb cccccccccc", box, 10, 12, measure);
    expect(l2.lines.map((x) => x.text)).toEqual(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"]);
    expect(l2.lines[0].baseline).toBeCloseTo(136 - 8);
    expect(l2.lines[1].baseline).toBeCloseTo(136 - 8 - 12);
    expect(l2.boxes[0]).toMatchObject({ x: 10, width: 100, height: 12 });
    expect(l2.boxes[2].height).toBeCloseTo(10.5);
    expect(l2.overflowLines).toBe(0);
  });
  it("breaks on newlines and reports overflow", () => {
    const l = layoutBlock("a\nb\nc\nd", box, 10, 12, measure);
    expect(l.lines).toHaveLength(4);
    expect(l.overflowLines).toBe(1);
    expect(l.height).toBeCloseTo(48);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/edit/layout.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

In `src/pdf/layout.ts` rename the private `wrap` to `export function wrapWords(text, width, size, measure): string[]` (update its two internal call sites). Then:

```ts
// src/edit/layout.ts
import type { Box } from "../pdf/types";
import { wrapWords, type Measure, type PlacedLine } from "../pdf/layout";
export interface BlockLayout { lines: PlacedLine[]; boxes: Box[]; height: number; overflowLines: number }

export function layoutBlock(text: string, box: Box, fontSize: number, lineHeight: number, measure: Measure): BlockLayout {
  const texts = wrapWords(text, box.width, fontSize, measure);
  const top = box.y + box.height;
  const lines: PlacedLine[] = texts.map((t, k) => ({ text: t, x: box.x, baseline: top - fontSize * 0.8 - k * lineHeight, width: box.width }));
  const boxes: Box[] = lines.map((l, k) => ({ x: box.x, y: l.baseline - fontSize * 0.25, width: box.width, height: k === lines.length - 1 ? fontSize * 1.05 : lineHeight }));
  const capacity = Math.max(1, Math.floor((box.height + 0.2 * lineHeight) / lineHeight));
  return { lines, boxes, height: lines.length * lineHeight, overflowLines: Math.max(0, lines.length - capacity) };
}
```

(`wrapWords` already splits on `\n` and breaks long words by character.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/edit src/pdf && npx tsc -b && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edit/layout.ts src/edit/layout.test.ts src/pdf/layout.ts
git commit -m "feat(edit): block layout with line height and overflow"
```

---

### Task 6: Edits in extracted text, OCR store rewrite, search re-index

**Files:**
- Modify: `src/pdf/text.ts`, `src/pdf/text.merge.test.ts` (append), `src/store/ocr.ts`, `src/store/ocr.test.ts` (append), `src/search/indexer.ts`, `src/store/search.ts`, `src/store/search.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  // src/pdf/text.ts
  export function editsStamp(sourceId: string): number          // ms timestamp of the last edits change affecting that source (0 if none)
  // extractPageText: after producing items (native or OCR), applies the page's edits: drops items whose centre is inside any edit box, inserts one item per laid-out edit line (fontName = edit font, fontSize, x, y=baseline, width)
  // src/store/ocr.ts
  export async function applyEditToOcr(sourceId: string, pageIndex: number, edit: Edit, measure: Measure): Promise<void>
  ```
  `src/search/indexer.ts` `defaultDeps.ocrVersion` returns `Math.max(ocrAt, editsStamp(source.id))`. `src/store/search.ts` subscribes to document `edits` changes and adds affected source ids to `finishedSources` then `armOcrReindex()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/pdf/text.merge.test.ts`:

```ts
import { editsStamp } from "./text";
import { layoutBlock } from "../edit/layout";
describe("edits overlay in extractPageText", () => {
  it("replaces covered items with the edit's lines and bumps the stamp", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    const st = useDocumentStore.getState();
    const src = [...st.sources.values()][0];
    const before = await extractPageText(src, 0);
    expect(before.text).toBe("three:0");
    const item = before.items[0];
    const box = { x: item.x, y: item.y - item.fontSize * 0.25, width: item.width + 2, height: item.fontSize * 1.2 };
    const lay = layoutBlock("nine:9", box, item.fontSize, item.fontSize * 1.2, (t, s) => t.length * s * 0.5);
    const t0 = Date.now();
    st.addEdit({ pageEntryId: st.pages[0].id, boxes: lay.boxes, text: "nine:9", fontSize: item.fontSize, font: "helvetica", color: [0, 0, 0], background: [1, 1, 1], lineHeight: item.fontSize * 1.2, source: "native", blockKey: "k" });
    const after = await extractPageText(src, 0);
    expect(after.text).toBe("nine:9");
    expect(after.items.map((i) => i.str)).toEqual(["nine:9"]);
    expect(editsStamp(src.id)).toBeGreaterThanOrEqual(t0);
    useDocumentStore.getState().undo();
    expect((await extractPageText(src, 0)).text).toBe("three:0");
  });
});
```

Append to `src/store/ocr.test.ts`:

```ts
import { applyEditToOcr } from "./ocr";
it("applyEditToOcr replaces only the words inside the edit boxes and keeps the engine", async () => {
  const id = await openScan(1);
  const hash = `h${n - 1}`;
  const page = { ...linesToOcrPage(["alpha beta", "gamma delta"], { widthPt: 300, heightPt: 400 }), engine: "claude" as const };
  await store.put(hash, 0, page);
  const line1 = page.lines[0].box;
  const edit = { id: "e", pageEntryId: `pg-${n - 1}-0`, boxes: [line1], text: "ALPHA BETA", fontSize: line1.height, font: "helvetica" as const, color: [0, 0, 0] as [number, number, number], background: [1, 1, 1] as [number, number, number], lineHeight: line1.height, source: "ocr" as const };
  await applyEditToOcr(id, 0, edit, (t, s) => t.length * s * 0.5);
  const after = await store.get(hash, 0);
  expect(after?.engine).toBe("claude");
  expect(after?.lines.map((l) => l.text)).toEqual(["ALPHA BETA", "gamma delta"]);
  expect(after?.lines[0].words.map((w) => w.text)).toEqual(["ALPHA", "BETA"]);
  expect(after!.at).toBeGreaterThan(page.at);
});
```

Append to `src/store/search.test.ts` (mocked `./ocr` pattern already in the file):

```ts
it("re-indexes a source after its edits change", async () => {
  // arrange: a ready model and one open source already indexed (reuse the file's existing setup helper), then:
  const st = useDocumentStore.getState();
  const p = st.pages[0].id;
  st.addEdit({ pageEntryId: p, boxes: [{ x: 0, y: 0, width: 10, height: 10 }], text: "z", fontSize: 10, font: "helvetica", color: [0, 0, 0], blockKey: "k" });
  await vi.advanceTimersByTimeAsync(2100);
  expect(indexSourceSpy).toHaveBeenCalledTimes(2); // once on open, once after the edit
});
```

(Adapt the arrangement to the file's existing fixtures: it mocks `../search/indexer` or uses a fake embed client; the assertion is that `indexSource` runs again after the edit and the 2 s debounce.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pdf/text.merge.test.ts src/store/ocr.test.ts src/store/search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pdf/text.ts`:

```ts
import { layoutBlock } from "../edit/layout";
import { measureFor } from "./metrics";
import { normalizeFont } from "./fonts";
import type { Edit } from "./types";

const stamps = new Map<string, number>();
export function editsStamp(sourceId: string): number { return stamps.get(sourceId) ?? 0; }

function pageEdits(sourceId: string, pageIndex: number): Edit[] {
  const { pages, edits } = useDocumentStore.getState();
  const ids = new Set(pages.filter((p) => p.sourceId === sourceId && p.sourcePageIndex === pageIndex).map((p) => p.id));
  return edits.filter((e) => ids.has(e.pageEntryId));
}

async function applyEdits(items: TextItemBox[], edits: Edit[]): Promise<TextItemBox[]> {
  if (!edits.length) return items;
  const inside = (i: TextItemBox, b: Box) => { const cx = i.x + i.width / 2, cy = i.y + i.fontSize * 0.3; return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height; };
  let out = items.filter((i) => !edits.some((e) => e.boxes.some((b) => inside(i, b))));
  for (const e of edits) {
    const font = normalizeFont(e.font);
    const measure = await measureFor(font);
    const region = regionOf(e.boxes);
    const lay = layoutBlock(e.text, region, e.fontSize, e.lineHeight ?? e.fontSize * 1.2, measure);
    out = out.concat(lay.lines.map((l) => ({ str: l.text, x: l.x, y: l.baseline, width: measure(l.text, e.fontSize), height: e.fontSize, fontSize: e.fontSize, fontName: font })));
  }
  return out;
}
```

In `extractPageText`, after computing the native `{ text, items }` or the OCR `{ text, items, ocr }`, run `const merged = await applyEdits(items, pageEdits(source.id, pageIndex));` and return `{ text: linesFromItems(merged.map(toRaw)), items: merged, ocr }` where `toRaw` maps a `TextItemBox` to `{ str, transform: [fontSize,0,0,fontSize,x,y], width, height }`. Import `regionOf` from `./layout`.

Subscription (module level, after the cache):

```ts
useDocumentStore.subscribe((s, prev) => {
  if (s.edits === prev.edits) return;
  const changed = new Set<string>();
  const all = [...s.edits, ...prev.edits];
  for (const e of all) {
    const inNext = s.edits.find((x) => x.id === e.id), inPrev = prev.edits.find((x) => x.id === e.id);
    if (inNext === inPrev) continue;
    const entry = s.pages.find((p) => p.id === e.pageEntryId) ?? prev.pages.find((p) => p.id === e.pageEntryId);
    if (entry) changed.add(`${entry.sourceId}:${entry.sourcePageIndex}`);
  }
  const now = Date.now();
  for (const k of changed) { cache.delete(k); stamps.set(k.slice(0, k.lastIndexOf(":")), now); }
});
```

`src/store/ocr.ts`:

```ts
export async function applyEditToOcr(sourceId: string, pageIndex: number, edit: Edit, measure: Measure): Promise<void> {
  const source = useDocumentStore.getState().sources.get(sourceId);
  if (!source?.hash) return;
  const page = await deps.store.get(source.hash, pageIndex);
  if (!page) return;
  const covered = (b: OcrBox) => edit.boxes.some((eb) => { const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx >= eb.x && cx <= eb.x + eb.width && cy >= eb.y && cy <= eb.y + eb.height; });
  const kept = page.lines.map((l) => ({ ...l, words: l.words.filter((w) => !covered(w.box)) })).filter((l) => l.words.length > 0).map((l) => ({ ...l, text: l.words.map((w) => w.text).join(" ") }));
  const region = regionOf(edit.boxes);
  const lay = layoutBlock(edit.text, region, edit.fontSize, edit.lineHeight ?? edit.fontSize * 1.2, measure);
  const newLines: OcrLine[] = lay.lines.map((l) => {
    let x = l.x;
    const words: OcrWord[] = l.text.split(/\s+/).filter(Boolean).map((t) => { const w = measure(t, edit.fontSize); const word = { text: t, box: { x, y: l.baseline - edit.fontSize * 0.25, width: w, height: edit.fontSize * 1.2 }, confidence: 1 }; x += w + measure(" ", edit.fontSize); return word; });
    return { text: l.text, box: { x: l.x, y: l.baseline - edit.fontSize * 0.25, width: l.width, height: edit.fontSize * 1.2 }, words };
  });
  const lines = [...kept, ...newLines].sort((a, b) => b.box.y - a.box.y);
  await deps.store.put(source.hash, pageIndex, { ...page, lines, at: Math.max(Date.now(), page.at + 1) });
  invalidatePageText(sourceId, pageIndex);
  useOcrStore.setState((s) => ({ pages: { ...s.pages } })); // nudge subscribers (search re-index)
}
```

Imports: `regionOf` from `../pdf/layout`, `layoutBlock` from `../edit/layout`, `OcrBox/OcrLine/OcrWord` types, `Measure`.

`src/search/indexer.ts`: `ocrVersion: async (source) => { ...; return Math.max(v, editsStamp(source.id)); }` (import `editsStamp` from `../pdf/text`).

`src/store/search.ts`: add

```ts
useDocumentStore.subscribe((s, prev) => {
  if (s.edits === prev.edits) return;
  const touched = new Set<string>();
  for (const e of [...s.edits, ...prev.edits]) { const p = s.pages.find((x) => x.id === e.pageEntryId) ?? prev.pages.find((x) => x.id === e.pageEntryId); if (p) touched.add(p.sourceId); }
  for (const sid of touched) finishedSources.add(sid);
  armOcrReindex();
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src && npx tsc -b && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pdf/text.ts src/pdf/text.merge.test.ts src/store/ocr.ts src/store/ocr.test.ts src/search/indexer.ts src/store/search.ts src/store/search.test.ts
git commit -m "feat(edit): edits flow into extracted text, OCR store, and search"
```

---

### Task 7: Edit tool and BlockEditor (open, type, apply, cancel)

**Files:**
- Create: `src/components/BlockEditor.tsx`, `src/components/BlockEditor.test.tsx`, `src/edit/pageBlocks.ts`
- Modify: `src/store/tools.ts` (`Tool` gains `"edit"`), `src/components/ToolPalette.tsx` (button + `e` key), `src/components/PageView.tsx` (click routing, hover), `src/components/TextLayer.tsx` (hidden spans), `src/styles.css`

**Interfaces:**
- Produces:
  ```ts
  // src/edit/pageBlocks.ts
  export async function pageBlocks(source: SourceFile, pageIndex: number): Promise<{ blocks: TextBlock[]; styles: Record<string, { fontFamily?: string }>; page: PDFPageProxy }>   // from extractPageText items (edits already applied) → linesFrom → blocksFrom; cached per (source,page,editsStamp)
  export interface OpenBlock { entry: PageEntry; source: SourceFile; block: TextBlock; font: EditFont; colors: { background: RGB; text: RGB }; blockKey: string; existing?: Edit; caretOffset: number }
  // src/components/BlockEditor.tsx
  export default function BlockEditor({ open, scale, heightPt, onClose }: { open: OpenBlock; scale: number; heightPt: number; onClose(): void })
  ```
  Behaviour: waits for `measureFor(open.font)`; renders a `contentEditable="plaintext-only"` div at the block (overlay coords), style `background`, `color`, `font: FONT_CSS[font]` at `fontSize·scale`, `line-height: lineHeight·scale px`, `white-space: pre-wrap`, width = block width·scale; pre-filled with `existing?.text ?? block.text`; on input re-lays out with `layoutBlock` to compute the hint (`Fits` / `Overflows by N line(s)`) and grows the div height to `max(block.height, layout.height)·scale`; Enter → apply, Shift+Enter → newline, Escape → cancel, blur (mousedown outside) → apply. Apply: if text equals the original (block.text when no existing edit, else existing.text) → close; else `addEdit({ pageEntryId, boxes: layout.boxes, text, fontSize, font, color: colors.text, background: colors.background, lineHeight, source, blockKey })` and, when `source === "ocr"`, `applyEditToOcr(...)`. A hint `Some characters cannot be saved in this font` shows when `toWinAnsi(text)` differs from `text`.
  PageView: with tool `edit`, `onMouseMove` over a page computes the point (crop-relative pt: `x = (clientX − rect.left)/scale`, `y = heightPt − (clientY − rect.top)/scale`), finds `blockAt`, and shows `.block-hint` outline; `onClick` opens the editor for the block (or the existing edit whose boxes contain the point: `existing` set, block synthesised from the edit's boxes/text). Rotated page → `setMessage("Rotate the page back to its original orientation to edit text.")`; no block → `setMessage("No text here.")`; block narrower than `measure("W", fontSize)` → `setMessage("Block too narrow to edit.")`.
  TextLayer: after render and on edits change, spans whose rect intersects any edit box of the page get `visibility: hidden` (`hideCoveredSpans(container, boxes, scale, heightPt)` exported for tests).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/BlockEditor.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import BlockEditor from "./BlockEditor";
import { useDocumentStore } from "../store/document";
import type { OpenBlock } from "../edit/pageBlocks";

vi.mock("../pdf/metrics", () => ({ measureFor: async () => (t: string, s: number) => t.length * s * 0.5 }));

const block = { lines: [], box: { x: 10, y: 100, width: 100, height: 12 }, lineHeight: 12, fontSize: 10, fontName: "f1", text: "Dose 10 mg", firstLineIndex: 0 };
const open = (over: Partial<OpenBlock> = {}): OpenBlock => ({
  entry: { id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 }, source: { id: "s", name: "a.pdf", bytes: new Uint8Array(), pageCount: 1 },
  block, font: "helvetica", colors: { background: [1, 1, 1], text: [0, 0, 0] }, blockKey: "s:0:0", caretOffset: 0, ...over,
});

beforeEach(() => { cleanup(); useDocumentStore.setState({ edits: [], pages: [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 }], past: [], future: [] }); });

describe("BlockEditor", () => {
  it("opens pre-filled once the measurer is ready and applies on Enter", async () => {
    const onClose = vi.fn();
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={onClose} />);
    const box = await screen.findByTestId("block-editor");
    expect(box.textContent).toBe("Dose 10 mg");
    box.textContent = "Dose 20 mg";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useDocumentStore.getState().edits).toHaveLength(1));
    expect(useDocumentStore.getState().edits[0]).toMatchObject({ text: "Dose 20 mg", font: "helvetica", blockKey: "s:0:0", source: "native", lineHeight: 12, background: [1, 1, 1] });
    expect(onClose).toHaveBeenCalled();
  });
  it("cancels on Escape and creates nothing when the text is unchanged", async () => {
    const onClose = vi.fn();
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={onClose} />);
    const box = await screen.findByTestId("block-editor");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(useDocumentStore.getState().edits).toHaveLength(0);
    cleanup();
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box2 = await screen.findByTestId("block-editor");
    fireEvent.keyDown(box2, { key: "Enter" });
    expect(useDocumentStore.getState().edits).toHaveLength(0);
  });
  it("shows the overflow hint and grows when the text no longer fits", async () => {
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box = await screen.findByTestId("block-editor");
    box.textContent = "a\nb\nc";
    fireEvent.input(box);
    expect(screen.getByTestId("block-hint").textContent).toBe("Overflows by 2 line(s)");
    expect(parseFloat(box.style.height)).toBeCloseTo(36);
  });
  it("reopens an existing edit with its text and replaces it", async () => {
    useDocumentStore.setState({ edits: [{ id: "ed-1", pageEntryId: "p", boxes: [block.box], text: "Old", fontSize: 10, font: "times", color: [0, 0, 0], blockKey: "s:0:0" }] });
    render(<BlockEditor open={open({ existing: useDocumentStore.getState().edits[0], font: "times" })} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box = await screen.findByTestId("block-editor");
    expect(box.textContent).toBe("Old");
    box.textContent = "New"; fireEvent.input(box); fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useDocumentStore.getState().edits[0].text).toBe("New"));
    expect(useDocumentStore.getState().edits).toHaveLength(1);
  });
  it("warns about characters outside WinAnsi", async () => {
    render(<BlockEditor open={open()} scale={1} heightPt={400} onClose={vi.fn()} />);
    const box = await screen.findByTestId("block-editor");
    box.textContent = "温度"; fireEvent.input(box);
    expect(screen.getByText("Some characters cannot be saved in this font")).toBeTruthy();
  });
});
```

Also a small test for the TextLayer helper in `src/components/TextLayer.ocr.test.tsx` (append):

```tsx
import { hideCoveredSpans } from "./TextLayer";
it("hides spans that intersect edit boxes", () => {
  const c = document.createElement("div");
  const a = document.createElement("span"); a.getBoundingClientRect = () => ({ left: 10, top: 10, width: 50, height: 10, right: 60, bottom: 20 } as DOMRect); c.appendChild(a);
  const b = document.createElement("span"); b.getBoundingClientRect = () => ({ left: 10, top: 200, width: 50, height: 10, right: 60, bottom: 210 } as DOMRect); c.appendChild(b);
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400 } as DOMRect);
  hideCoveredSpans(c, [{ x: 0, y: 380, width: 100, height: 15 }], 1, 400);
  expect(a.style.visibility).toBe("hidden");
  expect(b.style.visibility).toBe("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/BlockEditor.test.tsx src/components/TextLayer.ocr.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/store/tools.ts`: `Tool` adds `"edit"`. `ToolPalette.tsx`: add `{ id: "edit", label: "Edit text" }` after `select`; in the key handler add `if (e.key === "e" && !isEditing()) setTool("edit")` where `isEditing` checks `document.activeElement` is input/textarea/contentEditable (copy the helper from App.tsx).

```ts
// src/edit/pageBlocks.ts
import type { PageEntry, SourceFile, Edit, EditFont, RGB } from "../pdf/types";
import { extractPageText, editsStamp } from "../pdf/text";
import { getPage } from "../pdf/render";
import { linesFrom, blocksFrom, type TextBlock } from "./blocks";

export interface OpenBlock { entry: PageEntry; source: SourceFile; block: TextBlock; font: EditFont; colors: { background: RGB; text: RGB }; blockKey: string; existing?: Edit; caretOffset: number }

const cache = new Map<string, Promise<{ blocks: TextBlock[]; styles: Record<string, { fontFamily?: string }>; page: Awaited<ReturnType<typeof getPage>> }>>();
export async function pageBlocks(source: SourceFile, pageIndex: number) {
  const key = `${source.id}:${pageIndex}:${editsStamp(source.id)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const page = await getPage(source, pageIndex);
      const { items } = await extractPageText(source, pageIndex);
      const styles = (await page.getTextContent()).styles as Record<string, { fontFamily?: string }>;
      return { blocks: blocksFrom(linesFrom(items)), styles, page };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}
export function blockFromEdit(edit: Edit): TextBlock {
  const region = edit.boxes.reduce((r, b) => ({ x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), right: Math.max(r.right, b.x + b.width), top: Math.max(r.top, b.y + b.height) }), { x: Infinity, y: Infinity, right: -Infinity, top: -Infinity });
  return { lines: [], box: { x: region.x, y: region.y, width: region.right - region.x, height: region.top - region.y }, lineHeight: edit.lineHeight ?? edit.fontSize * 1.2, fontSize: edit.fontSize, fontName: edit.font, text: edit.text, firstLineIndex: -1 };
}
```

`BlockEditor.tsx` (sketch of the essential logic; keep it under ~120 lines):

```tsx
import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { applyEditToOcr } from "../store/ocr";
import { measureFor } from "../pdf/metrics";
import { FONT_CSS } from "../pdf/fonts";
import { toWinAnsi } from "../pdf/winansi";
import { layoutBlock } from "../edit/layout";
import type { Measure } from "../pdf/layout";
import type { OpenBlock } from "../edit/pageBlocks";

export default function BlockEditor({ open, scale, heightPt, onClose }: { open: OpenBlock; scale: number; heightPt: number; onClose(): void }) {
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [text, setText] = useState(open.existing?.text ?? open.block.text);
  const ref = useRef<HTMLDivElement>(null);
  const original = open.existing?.text ?? open.block.text;
  useEffect(() => { let on = true; void measureFor(open.font).then((m) => { if (on) setMeasure(() => m); }); return () => { on = false; }; }, [open.font]);
  useEffect(() => { if (measure && ref.current) { ref.current.textContent = text; ref.current.focus(); } }, [measure]); // eslint-disable-line react-hooks/exhaustive-deps -- set once when ready
  if (!measure) return null;
  const { block, font, colors } = open;
  const lay = layoutBlock(text, block.box, block.fontSize, block.lineHeight, measure);
  const height = Math.max(block.box.height, lay.height);
  const apply = async () => {
    const clean = text.replace(/ /g, " ").replace(/\s+$/g, "");
    if (clean === original || clean.trim() === "") { onClose(); return; }
    const l = layoutBlock(clean, block.box, block.fontSize, block.lineHeight, measure);
    const source = open.block.fontName === "ocr" || open.existing?.source === "ocr" ? "ocr" : "native";
    const edit = { pageEntryId: open.entry.id, boxes: l.boxes, text: clean, fontSize: block.fontSize, font, color: colors.text, background: colors.background, lineHeight: block.lineHeight, source, blockKey: open.blockKey } as const;
    const id = useDocumentStore.getState().addEdit(edit);
    if (source === "ocr") await applyEditToOcr(open.entry.sourceId, open.entry.sourcePageIndex, { ...edit, id }, measure);
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void apply(); }
  };
  const bad = toWinAnsi(text) !== text;
  return (
    <div className="block-editor-wrap" style={{ left: block.box.x * scale, top: (heightPt - block.box.y - block.box.height) * scale }}>
      <div ref={ref} data-testid="block-editor" className="block-editor" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
        style={{ width: block.box.width * scale, height: height * scale, background: `rgb(${colors.background.map((c) => Math.round(c * 255)).join(",")})`, color: `rgb(${colors.text.map((c) => Math.round(c * 255)).join(",")})`, font: FONT_CSS[font].replace("1px", `${block.fontSize * scale}px`), lineHeight: `${block.lineHeight * scale}px` }}
        onInput={(e) => setText((e.target as HTMLElement).innerText)} onKeyDown={onKey} onBlur={() => void apply()} />
      <div className="block-editor-bar">
        <span data-testid="block-hint">{lay.overflowLines > 0 ? `Overflows by ${lay.overflowLines} line(s)` : "Fits"}</span>
        {bad && <span className="block-warn">Some characters cannot be saved in this font</span>}
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => void apply()}>Done</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
```

`PageView.tsx`: keep `const [open, setOpen] = useState<OpenBlock | null>(null)` and `const [hint, setHint] = useState<{ pageId: string; box: Box } | null>(null)`; `tool === "edit"` handlers per page (`onMouseMove` debounced via `requestAnimationFrame`, `onClick`) using `pageBlocks`, `blockAt`, `fontInfoFor` + `matchFont`, `sampleBlockColors` (canvas = `pageEl.querySelector("canvas")`), existing edit lookup (`edits.find(e => e.pageEntryId === entry.id && e.boxes.some(b => contains(b, pt)))` → `existing` + `blockFromEdit`). Render `<BlockEditor>` inside the page div after the overlays; render the hint outline div. Text-layer pointer events are disabled while the tool is `edit` (`.page.tool-edit .textLayer { pointer-events: none }`), so clicks reach the page div.

`TextLayer.tsx`: export `hideCoveredSpans(container, boxes, scale, heightPt)`; call it after `layer.render()` and in an effect keyed on the page's edits (select `useDocumentStore((s) => s.edits.filter((e) => e.pageEntryId === entry.id))` with `useShallow`).

`styles.css`: append

```css
.page.tool-edit .textLayer { pointer-events: none; }
.page.tool-edit { cursor: text; }
.block-hint-outline { position: absolute; border: 1px dashed #2563eb; pointer-events: none; }
.block-editor-wrap { position: absolute; z-index: 30; }
.block-editor { outline: 1px solid #2563eb; white-space: pre-wrap; overflow: hidden; padding: 0; margin: 0; }
.block-editor-bar { position: absolute; left: 0; top: 100%; margin-top: 4px; display: flex; gap: 6px; align-items: center; font-size: 12px; background: var(--bg, white); border: 1px solid var(--border, #ccc); border-radius: 4px; padding: 2px 6px; white-space: nowrap; }
.block-warn { color: #a33; }
```

- [ ] **Step 4: Run tests, typecheck, lint, and a browser check**

Run: `npm test && npx tsc -b && npm run lint`. Then `npm run dev -- --port 5199`, open `three.pdf`, press `e`, hover a line (outline appears), click, change the text, Enter → cover and new text appear, the original is not selectable; undo restores.

- [ ] **Step 5: Commit**

```bash
git add src/store/tools.ts src/components/ToolPalette.tsx src/components/PageView.tsx src/components/TextLayer.tsx src/components/TextLayer.ocr.test.tsx src/components/BlockEditor.tsx src/components/BlockEditor.test.tsx src/edit/pageBlocks.ts src/styles.css
git commit -m "feat(edit): Edit text tool with in-place block editor"
```

---

### Task 8: Handles for existing edits (delete, font menu, drag, width) and reopen

**Files:**
- Create: `src/components/EditHandles.tsx`, `src/components/EditHandles.test.tsx`
- Modify: `src/components/EditOverlay.tsx` (render handles for the selected edit when tool is `edit`), `src/components/PageView.tsx` (reopen path already from Task 7; selection state), `src/styles.css`

**Interfaces:**
- Produces: `EditHandles({ edit, scale, heightPt, onReopen })` renders a bar above the edit with `Delete` (`data-testid="edit-delete"`), a font `<select data-testid="edit-font">` of the 12 faces grouped by family, a drag handle (`data-testid="edit-drag"`, moves all boxes by the pointer delta in points), and a right-edge handle (`data-testid="edit-width"`, changes the region width then re-lays out via `layoutBlock` and replaces `boxes`). All changes go through `updateEdit` (one commit per completed drag). Clicking the edit body calls `onReopen(edit)`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/EditHandles.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditHandles from "./EditHandles";
import { useDocumentStore } from "../store/document";
vi.mock("../pdf/metrics", () => ({ measureFor: async () => (t: string, s: number) => t.length * s * 0.5 }));

const edit = { id: "ed-1", pageEntryId: "p", boxes: [{ x: 10, y: 100, width: 100, height: 12 }], text: "Dose 10 mg", fontSize: 10, font: "helvetica" as const, color: [0, 0, 0] as [number, number, number], lineHeight: 12 };
beforeEach(() => { cleanup(); useDocumentStore.setState({ edits: [edit], past: [], future: [], pages: [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 }] }); });

describe("EditHandles", () => {
  it("deletes, changes the font, and reopens", () => {
    const onReopen = vi.fn();
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={onReopen} />);
    fireEvent.change(screen.getByTestId("edit-font"), { target: { value: "courier-bold" } });
    expect(useDocumentStore.getState().edits[0].font).toBe("courier-bold");
    fireEvent.click(screen.getByTestId("edit-body"));
    expect(onReopen).toHaveBeenCalledWith(expect.objectContaining({ id: "ed-1" }));
    fireEvent.click(screen.getByTestId("edit-delete"));
    expect(useDocumentStore.getState().edits).toHaveLength(0);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().edits).toHaveLength(1);
  });
  it("drags to move and re-lays out on width change", async () => {
    render(<EditHandles edit={edit} scale={1} heightPt={400} onReopen={vi.fn()} />);
    const drag = screen.getByTestId("edit-drag");
    fireEvent.pointerDown(drag, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(drag, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(drag, { clientX: 20, clientY: 10 });
    expect(useDocumentStore.getState().edits[0].boxes[0]).toMatchObject({ x: 30, y: 90 });
    const w = screen.getByTestId("edit-width");
    fireEvent.pointerDown(w, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(w, { clientX: -60, clientY: 0 });
    fireEvent.pointerUp(w, { clientX: -60, clientY: 0 });
    await screen.findByTestId("edit-drag");
    const boxes = useDocumentStore.getState().edits[0].boxes;
    expect(boxes[0].width).toBeCloseTo(40);
    expect(boxes.length).toBeGreaterThan(1); // "Dose 10 mg" no longer fits one 40pt line at 5pt/char
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/EditHandles.test.tsx`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`EditHandles.tsx`: position from `regionOf(edit.boxes)`; pointer capture for drag (`setPointerCapture`), compute deltas in points (`dx = (clientX − startX)/scale`, `dy = −(clientY − startY)/scale`), keep a local preview offset in state and call `updateEdit(id, { boxes: boxes.map(b => ({...b, x: b.x+dx, y: b.y+dy})) })` once on pointer up. Width handle: on pointer up, `const region = regionOf(edit.boxes); const width = Math.max(edit.fontSize, region.width + dx); const m = await measureFor(normalizeFont(edit.font)); const lay = layoutBlock(edit.text, { ...region, width }, edit.fontSize, edit.lineHeight ?? edit.fontSize*1.2, m); updateEdit(id, { boxes: lay.boxes })`. Font select: `updateEdit(id, { font })`. Delete: `removeEdit(id)`. The body (`data-testid="edit-body"`, a transparent div over the region) calls `onReopen(edit)`.

`EditOverlay.tsx`: accept `selectedEditId` and `onReopen` props (PageView passes them when the tool is `edit`); render `<EditHandles>` for the selected edit; clicking an edit with the edit tool (PageView's click path) sets it selected and reopens on a second click. `.editOverlay` keeps `pointer-events: none` but `.edit-handles *` and `.edit-body` get `pointer-events: auto`.

`styles.css`: append

```css
.edit-handles-bar { position: absolute; bottom: 100%; left: 0; margin-bottom: 4px; display: flex; gap: 6px; align-items: center; font-size: 12px; background: var(--bg, white); border: 1px solid var(--border, #ccc); border-radius: 4px; padding: 2px 6px; pointer-events: auto; white-space: nowrap; }
.edit-body { position: absolute; pointer-events: auto; cursor: text; }
.edit-drag { cursor: move; }
.edit-width { position: absolute; right: -4px; top: 0; width: 8px; height: 100%; cursor: ew-resize; pointer-events: auto; }
```

- [ ] **Step 4: Run tests, typecheck, lint, browser check (reopen, delete, font change, drag, width)**

Run: `npm test && npx tsc -b && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditHandles.tsx src/components/EditHandles.test.tsx src/components/EditOverlay.tsx src/components/PageView.tsx src/styles.css
git commit -m "feat(edit): reopen, delete, font menu, drag and width handles for edits"
```

---

### Task 9: End-to-end tests and docs

**Files:**
- Create: `e2e/edit.spec.ts`
- Modify: `README.md` (paragraph "Edit text" after "OCR"), `docs/superpowers/specs/2026-10-11-text-editing-design.md` (record any rulings made during execution)

- [ ] **Step 1: Write the e2e tests**

```ts
// e2e/edit.spec.ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });
async function savedText(page: import("@playwright/test").Page): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = readFileSync((await download.path()) as string);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  return tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
}

test("edit a typed line in place and download", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("three"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await page.getByTestId("tool-edit").click();
  const span = page.locator(".page").first().locator(".textLayer span", { hasText: "three:0" });
  const b = await span.boundingBox();
  await page.mouse.click(b!.x + 5, b!.y + b!.height / 2);
  const editor = page.getByTestId("block-editor");
  await expect(editor).toHaveText("three:0");
  await editor.press("Control+a");
  await editor.type("three:9");
  await editor.press("Enter");
  await expect(page.locator(".edit-line").first()).toHaveText("three:9");
  const text = await savedText(page);
  expect(text).toContain("three:9");
  expect(text).not.toContain("three:0");
});

test.describe("scan", () => {
  test.skip(!process.env.E2E_OCR, "set E2E_OCR=1 (downloads Tesseract)");
  test("edit a recognized word on a scan", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("scan"));
    await expect(page.getByTestId("ocr-badge").first()).toHaveText("Text recognized", { timeout: 120_000 });
    await page.getByTestId("tool-edit").click();
    const span = page.locator(".page .textLayer span", { hasText: /hypertension/i }).first();
    const b = await span.boundingBox();
    await page.mouse.click(b!.x + 5, b!.y + b!.height / 2);
    const editor = page.getByTestId("block-editor");
    await expect(editor).toContainText(/hypertension/i);
    const current = await editor.innerText();
    await editor.press("Control+a");
    await editor.type(current.replace(/hypertension/i, "hypotension"));
    await editor.press("Enter");
    await expect(page.locator(".edit-line", { hasText: "hypotension" })).toBeVisible();
    const text = await savedText(page);
    expect(text).toMatch(/hypotension/i);
    expect(text).not.toMatch(/hypertension/i);
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx playwright test e2e/edit.spec.ts` then `E2E_OCR=1 npx playwright test e2e/edit.spec.ts`
Expected: typed test passes ungated; both pass gated. If `Control+a` does not select inside the contentEditable under headless Chromium, use `editor.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); })` before typing, and note it in the report.

- [ ] **Step 3: Docs**

README, after the OCR paragraph:

> **Edit text.** Choose *Edit text* (or press `e`), click any paragraph, and change it in place. The original is covered in the page's own background colour and the new text is drawn in the closest of the twelve standard PDF faces (Helvetica, Times, Courier and their bold/italic variants), matched from the original font's name and flags. Edits reflow inside the block, can be reopened, moved, resized, re-fonted or deleted, and are included in Summarize, Ask, Search, and the downloaded PDF. On scanned pages the recognized text is updated too. Pages must be shown unrotated to edit.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run worker:test && npx tsc -b && npm run lint && npx playwright test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add e2e/edit.spec.ts README.md docs/superpowers/specs/2026-10-11-text-editing-design.md
git commit -m "test(edit): end-to-end coverage; docs"
```
