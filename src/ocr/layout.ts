import type { TextItemBox } from "../pdf/text";
import type { OcrLine, OcrPage, OcrWord, PageMetaPt } from "./types";

export interface TessBbox { x0: number; y0: number; x1: number; y1: number }
export interface TessWord { text: string; bbox: TessBbox; confidence: number }
export interface TessLine { text: string; bbox: TessBbox; words: TessWord[] }

export const EMPTY_CONFIDENCE = 0.3;
const MARGIN = 36;
const MAX_LINE_HEIGHT = 14;
const CLAUDE_WORD_CONFIDENCE = 0.9;

function toBox(b: TessBbox, scale: number, heightPt: number) {
  return { x: b.x0 / scale, y: heightPt - b.y1 / scale, width: (b.x1 - b.x0) / scale, height: (b.y1 - b.y0) / scale };
}

export function tesseractToOcrPage(lines: TessLine[], pageConfidence: number, scale: number, heightPt: number, at = Date.now()): OcrPage {
  const out: OcrLine[] = [];
  for (const l of lines) {
    const words: OcrWord[] = l.words.filter((w) => w.text.trim().length > 0).map((w) => ({ text: w.text.trim(), box: toBox(w.bbox, scale, heightPt), confidence: w.confidence / 100 }));
    if (words.length === 0) continue;
    out.push({ text: words.map((w) => w.text).join(" "), box: toBox(l.bbox, scale, heightPt), words });
  }
  return { engine: "tesseract", lines: out, confidence: pageConfidence / 100, at };
}

export function linesToOcrPage(rawLines: string[], meta: PageMetaPt, at = Date.now()): OcrPage {
  const texts = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  const lineHeight = texts.length === 0 ? MAX_LINE_HEIGHT : Math.min(MAX_LINE_HEIGHT, (meta.heightPt - 2 * MARGIN) / texts.length);
  const width = meta.widthPt - 2 * MARGIN;
  const lines: OcrLine[] = texts.map((text, i) => {
    const y = meta.heightPt - MARGIN - lineHeight * (i + 1);
    const parts = text.split(/\s+/);
    const chars = parts.reduce((n, p) => n + p.length, 0) || 1;
    let x = MARGIN;
    const words: OcrWord[] = parts.map((p) => {
      const w = (width * p.length) / chars;
      const word = { text: p, box: { x, y, width: w, height: lineHeight }, confidence: CLAUDE_WORD_CONFIDENCE };
      x += w;
      return word;
    });
    return { text, box: { x: MARGIN, y, width, height: lineHeight }, words };
  });
  return { engine: "claude", lines, confidence: texts.length ? CLAUDE_WORD_CONFIDENCE : 0, at };
}

export function ocrPageToItems(page: OcrPage): TextItemBox[] {
  return page.lines.flatMap((l) => l.words.map((w) => ({ str: w.text, x: w.box.x, y: w.box.y, width: w.box.width, height: w.box.height, fontSize: l.box.height })));
}

export function ocrPageText(page: OcrPage): string {
  return page.lines.map((l) => l.text).join("\n");
}

export function isEmptyOcr(page: OcrPage): boolean {
  return page.lines.every((l) => l.words.length === 0) || page.confidence < EMPTY_CONFIDENCE;
}
