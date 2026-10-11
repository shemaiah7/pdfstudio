import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { layoutInBoxes } from "./layout";
import { toWinAnsi } from "./winansi";
import type { Edit, PageEntry, Rotation, SourceFile, SourceId } from "./types";

export function addRotation(a: Rotation, delta: 90 | -90 | 180): Rotation {
  return (((a + delta) % 360) + 360) % 360 as Rotation;
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return doc.getPageCount();
}

export async function buildDocument(
  sources: Map<SourceId, SourceFile>,
  pages: PageEntry[],
  edits: Edit[] = [],
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const loaded = new Map<SourceId, PDFDocument>();

  for (const entry of pages) {
    const source = sources.get(entry.sourceId);
    if (!source) throw new Error(`Unknown source ${entry.sourceId}`);
    if (entry.sourcePageIndex >= source.pageCount) {
      throw new Error(
        `${source.name} has no page ${entry.sourcePageIndex + 1}`,
      );
    }
    let doc = loaded.get(entry.sourceId);
    if (!doc) {
      doc = await PDFDocument.load(source.bytes);
      loaded.set(entry.sourceId, doc);
    }
    const [copied] = await out.copyPages(doc, [entry.sourcePageIndex]);
    const base = copied.getRotation().angle;
    copied.setRotation(degrees((((base + entry.rotation) % 360) + 360) % 360));
    out.addPage(copied);

    const pageEdits = edits.filter((e) => e.pageEntryId === entry.id);
    if (pageEdits.length) {
      const fonts = {
        sans: await out.embedFont(StandardFonts.Helvetica),
        "sans-bold": await out.embedFont(StandardFonts.HelveticaBold),
        serif: await out.embedFont(StandardFonts.TimesRoman),
      };
      // Selection boxes are relative to the crop box origin (pdf.js page.view).
      const { x: ox, y: oy } = copied.getCropBox();
      for (const e of pageEdits) {
        for (const b of e.boxes) copied.drawRectangle({ x: b.x + ox, y: b.y + oy, width: b.width, height: b.height, color: rgb(1, 1, 1) });
        const font = fonts[e.font];
        const width = (t: string, s: number) => font.widthOfTextAtSize(toWinAnsi(t), s);
        // The Insert gate prevents overflow edits; if one slips through, draw every line anyway.
        const { lines, fontSize } = layoutInBoxes(e.text, e.boxes, e.fontSize, width, { keepOverflow: true });
        const color = rgb(e.color[0], e.color[1], e.color[2]);
        for (const line of lines) {
          const opts = { x: line.x + ox, y: line.baseline + oy, size: fontSize, font, color };
          // Draw exactly the string that was measured.
          const drawn = toWinAnsi(line.text);
          try { copied.drawText(drawn, opts); }
          catch { copied.drawText(drawn.replace(/[^\x20-\x7E]/g, "?"), opts); }
        }
      }
    }
  }

  return out.save();
}
