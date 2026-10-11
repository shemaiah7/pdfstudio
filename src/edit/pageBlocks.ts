import type { PageEntry, SourceFile, Edit, EditFont, RGB } from "../pdf/types";
import { extractPageText, editsStamp } from "../pdf/text";
import { getPage } from "../pdf/render";
import { sourceReleasers } from "../store/document";
import { useOcrStore, pageKey } from "../store/ocr";
import { linesFrom, blocksFrom, type TextBlock } from "./blocks";

export interface OpenBlock { entry: PageEntry; source: SourceFile; block: TextBlock; font: EditFont; colors: { background: RGB; text: RGB }; blockKey: string; existing?: Edit; caretOffset: number }

type PageBlocks = { blocks: TextBlock[]; styles: Record<string, { fontFamily?: string }>; page: Awaited<ReturnType<typeof getPage>> };
/** One entry per page: replaced when the edits stamp or OCR state in the key changes, dropped when empty or failed. */
const cache = new Map<string, { key: string; p: Promise<PageBlocks> }>();
const pageKeyOf = (source: SourceFile, pageIndex: number) => `${source.id}:${pageIndex}`;
function ocrStateOf(source: SourceFile, pageIndex: number): string {
  const st = useOcrStore.getState().pages[pageKey(source.id, pageIndex)];
  return st ? `${st.state}:${st.engine ?? ""}` : "none";
}
export function clearPageBlocks(sourceId?: string): void {
  for (const k of [...cache.keys()]) if (!sourceId || k.startsWith(`${sourceId}:`)) cache.delete(k);
}
sourceReleasers.push((id) => clearPageBlocks(id));

export async function pageBlocks(source: SourceFile, pageIndex: number): Promise<PageBlocks> {
  const page = pageKeyOf(source, pageIndex);
  const key = `${page}:${editsStamp(source.id)}:${ocrStateOf(source, pageIndex)}`;
  const hit = cache.get(page);
  if (hit?.key === key) return hit.p;
  const entry = { key } as { key: string; p: Promise<PageBlocks> };
  entry.p = (async () => {
      const pdfPage = await getPage(source, pageIndex);
      const { items } = await extractPageText(source, pageIndex);
      const styles = (await pdfPage.getTextContent()).styles as Record<string, { fontFamily?: string }>;
      const result = { blocks: blocksFrom(linesFrom(items)), styles, page: pdfPage };
      if (!result.blocks.length && cache.get(page) === entry) cache.delete(page); // an empty list may only mean OCR has not finished
      return result;
    })();
  cache.set(page, entry);
  entry.p.catch(() => { if (cache.get(page) === entry) cache.delete(page); });
  return entry.p;
}
export function blockFromEdit(edit: Edit): TextBlock {
  const region = edit.boxes.reduce((r, b) => ({ x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), right: Math.max(r.right, b.x + b.width), top: Math.max(r.top, b.y + b.height) }), { x: Infinity, y: Infinity, right: -Infinity, top: -Infinity });
  const bounds = { x: region.x, y: region.y, width: region.right - region.x, height: region.top - region.y };
  return { lines: [], box: edit.frame ?? edit.region ?? bounds, lineHeight: edit.lineHeight ?? edit.fontSize * 1.2, fontSize: edit.fontSize, fontName: edit.font, text: edit.text, firstLineIndex: -1 };
}
