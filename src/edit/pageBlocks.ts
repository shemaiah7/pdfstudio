import type { PageEntry, SourceFile, Edit, EditFont, RGB } from "../pdf/types";
import { extractPageText, editsStamp } from "../pdf/text";
import { getPage } from "../pdf/render";
import { linesFrom, blocksFrom, type TextBlock } from "./blocks";

export interface OpenBlock { entry: PageEntry; source: SourceFile; block: TextBlock; font: EditFont; colors: { background: RGB; text: RGB }; blockKey: string; existing?: Edit; caretOffset: number }

type PageBlocks = { blocks: TextBlock[]; styles: Record<string, { fontFamily?: string }>; page: Awaited<ReturnType<typeof getPage>> };
const cache = new Map<string, Promise<PageBlocks>>();
export async function pageBlocks(source: SourceFile, pageIndex: number): Promise<PageBlocks> {
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
  const bounds = { x: region.x, y: region.y, width: region.right - region.x, height: region.top - region.y };
  return { lines: [], box: edit.region ?? bounds, lineHeight: edit.lineHeight ?? edit.fontSize * 1.2, fontSize: edit.fontSize, fontName: edit.font, text: edit.text, firstLineIndex: -1 };
}
