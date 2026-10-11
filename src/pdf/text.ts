import type { SourceFile } from "./types";
import { getPage } from "./render";
import { ocrStore } from "../ocr/store";
import { ocrPageToItems, ocrPageText } from "../ocr/layout";
import { useDocumentStore, sourceReleasers } from "../store/document";

export interface TextItemBox { str: string; x: number; y: number; width: number; height: number; fontSize: number }
export interface PageText { text: string; items: TextItemBox[]; ocr?: boolean }

interface RawItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

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

const cache = new Map<string, Promise<PageText>>();

// Document lifetime is owned by render.ts (getPage / releaseSource); this clears only extracted text.
export function clearTextCache(sourceId?: string): void {
  for (const k of [...cache.keys()]) if (!sourceId || k.startsWith(`${sourceId}:`)) cache.delete(k);
}

export function invalidatePageText(sourceId: string, pageIndex: number): void { cache.delete(`${sourceId}:${pageIndex}`); }

export async function extractPageText(source: SourceFile, pageIndex: number): Promise<PageText> {
  const key = `${source.id}:${pageIndex}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const page = await getPage(source, pageIndex);
      const content = await page.getTextContent();
      const raw = content.items.filter((i) => "str" in i) as unknown as RawItem[];
      const items: TextItemBox[] = raw.filter((i) => i.str.length > 0).map((i) => ({
        str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height,
        fontSize: Math.hypot(i.transform[2], i.transform[3]) || i.height,
      }));
      const text = linesFromItems(raw);
      if (text.trim().length > 0 || !source.hash) return { text, items };
      const ocr = await ocrStore.get(source.hash, pageIndex);
      if (!ocr) return { text: "", items: [] };
      return { text: ocrPageText(ocr), items: ocrPageToItems(ocr), ocr: true };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

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
