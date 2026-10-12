import type { Box, Edit, PageEntry, RGB, SourceFile } from "../pdf/types";
import type { TextItemBox } from "../pdf/text";
import { linesFrom, linesInBox, type TextLine } from "./blocks";
import { runsFor, runsFromEdit, type OpenLine, type OpenLines, type PdfPageLike, type Styles } from "./runs";
import { useDocumentStore } from "../store/document";
import { lineFrame } from "./layout";

export interface PageTextForEdit { items: TextItemBox[]; page: PdfPageLike; styles: Styles }

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const vOverlap = (a: Box, b: Box) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
const hOverlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width;

/** Lines inside the box, as editable runs; a detected line reopens the existing line edit it mostly covers, and edits with no detected line (white-outs) get a synthetic line. */
export async function openLinesIn(text: PageTextForEdit, source: SourceFile, entry: PageEntry, box: Box, sample: (b: Box) => { background: RGB; text: RGB }): Promise<OpenLines | null> {
  const lines: TextLine[] = linesInBox(linesFrom(text.items), box);
  const edits = useDocumentStore.getState().edits.filter((e) => e.pageEntryId === entry.id && e.kind === "line");
  const claimed = new Set<string>();
  const open: OpenLine[] = lines.map((line) => {
    let existing: Edit | undefined, best = -Infinity;
    for (const e of edits) {
      if (claimed.has(e.id)) continue;
      const f = lineFrame(e), v = vOverlap(f, line.box);
      if (v >= line.box.height / 2 && hOverlap(f, line.box) && v > best) { existing = e; best = v; }
    }
    if (existing) claimed.add(existing.id);
    const background = existing?.background ?? sample(line.box).background;
    if (existing) return { line, runs: runsFromEdit(existing), existing, background };
    const colorFor = (r: TextLine["runs"][number]) => sample({ x: r.x, y: line.box.y, width: r.width, height: line.box.height }).text;
    return { line, runs: runsFor(line, text.page, text.styles, [0, 0, 0], colorFor), background };
  });
  for (const e of edits) {
    const frame = lineFrame(e);
    if (claimed.has(e.id) || !overlaps(frame, box)) continue;
    const line: TextLine = { text: e.text, x: e.x ?? frame.x, baseline: e.baseline ?? frame.y + (frame.height * 0.25) / 1.2, width: frame.width, fontSize: e.fontSize, fontName: e.font, items: [], runs: [], box: frame };
    open.push({ line, runs: runsFromEdit(e), existing: e, background: e.background ?? sample(frame).background });
  }
  if (!open.length) return null;
  open.sort((a, b) => b.line.baseline - a.line.baseline);
  return { entry, source, box, lines: open, background: sample(box).background };
}
