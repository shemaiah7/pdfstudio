import { PDFDocument, type PDFFont } from "pdf-lib";
import type { Measure } from "./layout";
import type { EditFont } from "./types";
import { STANDARD_FONTS, normalizeFont } from "./fonts";
import { toWinAnsi } from "./winansi";

let doc: Promise<PDFDocument> | null = null;
const faces = new Map<EditFont, Promise<PDFFont>>();

function loadFont(face: EditFont): Promise<PDFFont> {
  doc ??= PDFDocument.create();
  let p = faces.get(face);
  if (!p) {
    p = doc.then((d) => d.embedFont(STANDARD_FONTS[face]));
    faces.set(face, p);
  }
  return p;
}

/** Measurer backed by the same pdf-lib font metrics the export uses. */
export async function measureFor(font: EditFont): Promise<Measure> {
  const f = await loadFont(normalizeFont(font));
  return (text, size) => f.widthOfTextAtSize(toWinAnsi(text), size);
}
