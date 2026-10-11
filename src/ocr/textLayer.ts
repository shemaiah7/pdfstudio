// src/ocr/textLayer.ts
import { PDFFont, PDFPage, beginMarkedContent, beginText, endMarkedContent, endText, setFontAndSize, setTextMatrix, setTextRenderingMode, showText, TextRenderingMode, pushGraphicsState, popGraphicsState } from "pdf-lib";
import { toWinAnsi } from "../pdf/winansi";
import type { OcrPage } from "./types";

const ASCENT = 0.8; // baseline sits this far below the box top, as a fraction of box height

/** Draws every OCR word as invisible text (render mode 3) so other readers can search and select it. */
export function addInvisibleText(page: PDFPage, font: PDFFont, ocr: OcrPage, cropOrigin: { x: number; y: number }): void {
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const ops = [pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const line of ocr.lines) {
    for (const w of line.words) {
      const text = toWinAnsi(w.text).replace(/[^\x20-\xFF]/g, "?");
      if (!text.trim()) continue;
      const size = Math.max(1, w.box.height * 0.9);
      const natural = font.widthOfTextAtSize(text, size) || 1;
      const sx = w.box.width / natural;           // squeeze or stretch so the word spans its box
      const x = w.box.x + cropOrigin.x;
      const y = w.box.y + cropOrigin.y + w.box.height * (1 - ASCENT);
      ops.push(beginMarkedContent("Span"), beginText(), setFontAndSize(fontKey, size), setTextMatrix(sx, 0, 0, 1, x, y), showText(font.encodeText(text)), endText(), endMarkedContent()); // marked content per word stops readers merging neighbouring words into one run
    }
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}
