import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { layoutText, regionOf } from "./layout";
import type { Edit, PageEntry, Rotation, SourceFile, SourceId } from "./types";

export function addRotation(a: Rotation, delta: 90 | -90 | 180): Rotation {
  return (((a + delta) % 360) + 360) % 360 as Rotation;
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return doc.getPageCount();
}

// Standard fonts only encode WinAnsi; replace anything else so export never throws.
const toWinAnsi = (t: string) => t.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");

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
      for (const e of pageEdits) {
        for (const b of e.boxes) copied.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, color: rgb(1, 1, 1) });
        const font = fonts[e.font];
        const safeWidth = (t: string, s: number) => {
          try { return font.widthOfTextAtSize(t, s); } catch { return font.widthOfTextAtSize(toWinAnsi(t), s); }
        };
        const { lines, fontSize } = layoutText(e.text, regionOf(e.boxes), e.fontSize, safeWidth);
        const color = rgb(e.color[0], e.color[1], e.color[2]);
        for (const line of lines) {
          const opts = { x: line.x, y: line.baseline, size: fontSize, font, color };
          try { copied.drawText(line.text, opts); }
          catch { copied.drawText(toWinAnsi(line.text), opts); }
        }
      }
    }
  }

  return out.save();
}
