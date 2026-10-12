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
