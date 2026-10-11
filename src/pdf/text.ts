import type { SourceFile, Box, Edit } from "./types";
import { placeEdit } from "../edit/layout";
import { measureFor } from "./metrics";
import { normalizeFont } from "./fonts";
import { getPage } from "./render";
import { ocrStore } from "../ocr/store";
import { ocrPageToItems, ocrPageText } from "../ocr/layout";
import { useDocumentStore, sourceReleasers } from "../store/document";

export interface TextItemBox { str: string; x: number; y: number; width: number; height: number; fontSize: number; fontName: string }
export interface PageText { text: string; items: TextItemBox[]; ocr?: boolean }

interface RawItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }

export function linesFromItems(items: RawItem[]): string {
  const placed = items
    .filter((i) => i.str.length > 0)
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.hypot(i.transform[2], i.transform[3]) || 10 }));
  // Group into lines: same baseline within half the font size.
  placed.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: (typeof placed)[] = [];
  for (const p of placed) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - p.y) <= line[0].size * 0.5) line.push(p);
    else lines.push([p]);
  }
  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      let out = "";
      let cursor = -Infinity;
      for (const p of line) {
        const gap = p.x - cursor;
        if (out && gap > p.size * 0.15 && !out.endsWith(" ") && !p.str.startsWith(" ")) out += " ";
        out += p.str;
        cursor = p.x + p.w;
      }
      return out.replace(/\s+/g, " ").trim();
    })
    .filter((l) => l.length > 0)
    .join("\n");
}

export function hasAnyText(pages: { text: string }[]): boolean {
  return pages.some((p) => p.text.trim().length > 0);
}

let lookupOcr: (hash: string, pageIndex: number) => ReturnType<typeof ocrStore.get> = (h, p) => ocrStore.get(h, p);
/** Test seam: replace (or with no argument, restore) the OCR text lookup. */
export function setOcrLookup(fn?: typeof lookupOcr): void { lookupOcr = fn ?? ((h, p) => ocrStore.get(h, p)); }

const cache = new Map<string, Promise<PageText>>();

// Document lifetime is owned by render.ts (getPage / releaseSource); this clears only extracted text.
export function clearTextCache(sourceId?: string): void {
  for (const k of [...cache.keys()]) if (!sourceId || k.startsWith(`${sourceId}:`)) cache.delete(k);
}

export function invalidatePageText(sourceId: string, pageIndex: number): void { cache.delete(`${sourceId}:${pageIndex}`); }

const stamps = new Map<string, number>();
export function editsStamp(sourceId: string): number { return stamps.get(sourceId) ?? 0; }

function pageEdits(sourceId: string, pageIndex: number): Edit[] {
  const { pages, edits } = useDocumentStore.getState();
  const ids = new Set(pages.filter((p) => p.sourceId === sourceId && p.sourcePageIndex === pageIndex).map((p) => p.id));
  return edits.filter((e) => ids.has(e.pageEntryId));
}

/**
 * Same rule as hideCoveredSpans: an item goes when a cover overlaps it horizontally and reaches its central band,
 * so a neighbouring line that merely grazes a cover's edge (tight or 1.2 leading) stays.
 * Native items sit on a baseline (band 0.1..0.6 of the font size above it); OCR items are tight boxes whose y is the bottom (middle 60 %).
 */
export function coveredBy(i: TextItemBox, boxes: Box[]): boolean {
  const ocr = i.fontName === "ocr";
  const bandBottom = ocr ? i.y + 0.2 * i.height : i.y + 0.1 * i.fontSize;
  const bandTop = ocr ? i.y + 0.8 * i.height : i.y + 0.6 * i.fontSize;
  return boxes.some((b) => i.x < b.x + b.width && b.x < i.x + i.width && b.y < bandTop && bandBottom < b.y + b.height);
}

async function applyEdits(items: TextItemBox[], edits: Edit[]): Promise<TextItemBox[]> {
  if (!edits.length) return items;
  const placed = await Promise.all(edits.map(async (e) => {
    const font = normalizeFont(e.font);
    const measure = await measureFor(font);
    return { e, font, measure, ...placeEdit(e, measure) };
  }));
  const covers = placed.flatMap((p) => p.boxes);
  let out = items.filter((i) => !coveredBy(i, covers));
  for (const { font, measure, lines, fontSize } of placed) {
    out = out.concat(lines.map((l) => ({ str: l.text, x: l.x, y: l.baseline, width: measure(l.text, fontSize), height: fontSize, fontSize, fontName: font })));
  }
  return out;
}

const toRaw = (i: TextItemBox): RawItem => ({ str: i.str, transform: [i.fontSize, 0, 0, i.fontSize, i.x, i.y], width: i.width, height: i.height });

async function withEdits(base: PageText, sourceId: string, pageIndex: number): Promise<PageText> {
  const edits = pageEdits(sourceId, pageIndex);
  if (!edits.length) return base;
  const merged = await applyEdits(base.items, edits);
  return { ...base, text: linesFromItems(merged.map(toRaw)), items: merged };
}

export async function extractPageText(source: SourceFile, pageIndex: number): Promise<PageText> {
  const key = `${source.id}:${pageIndex}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const page = await getPage(source, pageIndex);
      const content = await page.getTextContent();
      const raw = content.items.filter((i) => "str" in i) as unknown as RawItem[];
      // pdf.js reports user-space positions; edits, blocks and the flatten layer are relative to the crop box origin.
      const [ox, oy] = page.view;
      const items: TextItemBox[] = raw.filter((i) => i.str.length > 0).map((i) => ({
        str: i.str, x: i.transform[4] - ox, y: i.transform[5] - oy, width: i.width, height: i.height,
        fontSize: Math.hypot(i.transform[2], i.transform[3]) || i.height,
        fontName: (i as { fontName?: string }).fontName ?? "",
      }));
      const text = linesFromItems(raw);
      if (text.trim().length > 0 || !source.hash) return withEdits({ text, items }, source.id, pageIndex);
      let ocr: Awaited<ReturnType<typeof ocrStore.get>>;
      try { ocr = await lookupOcr(source.hash, pageIndex); } catch { return withEdits({ text: "", items: [] }, source.id, pageIndex); }
      if (!ocr) return withEdits({ text: "", items: [] }, source.id, pageIndex);
      return withEdits({ text: ocrPageText(ocr), items: ocrPageToItems(ocr), ocr: true }, source.id, pageIndex);
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

useDocumentStore.subscribe((s, prev) => {
  if (s.edits === prev.edits) return;
  const changed = new Set<string>();
  for (const e of [...s.edits, ...prev.edits]) {
    const inNext = s.edits.find((x) => x.id === e.id), inPrev = prev.edits.find((x) => x.id === e.id);
    if (inNext === inPrev) continue;
    const entry = s.pages.find((p) => p.id === e.pageEntryId) ?? prev.pages.find((p) => p.id === e.pageEntryId);
    if (entry) changed.add(`${entry.sourceId}:${entry.sourcePageIndex}`);
  }
  const now = Date.now();
  for (const k of changed) { cache.delete(k); stamps.set(k.slice(0, k.lastIndexOf(":")), now); }
});

export async function documentText(scope: "all" | "selected"): Promise<{ page: number; text: string }[]> {
  const { pages, sources, selection } = useDocumentStore.getState();
  const out: { page: number; text: string }[] = [];
  for (let i = 0; i < pages.length; i++) {
    const entry = pages[i];
    if (scope === "selected" && !selection.has(entry.id)) continue;
    const source = sources.get(entry.sourceId)!;
    const { text } = await extractPageText(source, entry.sourcePageIndex);
    out.push({ page: i + 1, text });
  }
  return out;
}

sourceReleasers.push((id) => clearTextCache(id));
