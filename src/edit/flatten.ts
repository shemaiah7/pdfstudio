import { PDFName, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { addInvisibleText } from "../ocr/textLayer";
import type { OcrLine, OcrPage } from "../ocr/types";
import type { TextItemBox } from "../pdf/text";
import type { SourceFile } from "../pdf/types";
import { linesFrom } from "./blocks";

export interface FlattenInput {
  png: Uint8Array; widthPt: number; heightPt: number;
  /** Edited extracted items, crop-relative. */
  items: TextItemBox[];
  cropOrigin: { x: number; y: number };
}

export function itemsToOcrPage(items: TextItemBox[]): OcrPage {
  const lines: OcrLine[] = linesFrom(items).map((l) => {
    const words = l.items.map((i) => ({ text: i.str, confidence: 1, box: { x: i.x, y: i.y - 0.25 * i.fontSize, width: i.width, height: 1.2 * i.fontSize } }));
    const x = Math.min(...words.map((w) => w.box.x)), y = Math.min(...words.map((w) => w.box.y));
    const right = Math.max(...words.map((w) => w.box.x + w.box.width)), top = Math.max(...words.map((w) => w.box.y + w.box.height));
    return { text: l.text, box: { x, y, width: right - x, height: top - y }, words };
  });
  return { engine: "tesseract", lines, confidence: 1, at: 0 };
}

/**
 * Replaces the page's content with a raster of the original, then (via drawEdits) the edit covers and text,
 * then an invisible text layer, so text hidden under an edit cannot be extracted from the output.
 */
export async function flattenPage(doc: PDFDocument, page: PDFPage, input: FlattenInput, font: PDFFont, drawEdits?: () => Promise<void> | void): Promise<void> {
  const image = await doc.embedPng(input.png); // before clearing, so a bad raster leaves the page intact for the caller's fallback
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("")));
  const crop = page.getCropBox();
  page.drawImage(image, { x: crop.x, y: crop.y, width: crop.width, height: crop.height });
  await drawEdits?.();
  addInvisibleText(page, font, itemsToOcrPage(input.items), input.cropOrigin);
}

export const MAX_RASTER_PIXELS = 20_000_000;
/** Scale (px per pt) for the requested DPI, reduced so widthPx * heightPx stays within MAX_RASTER_PIXELS. */
export function cappedScale(widthPt: number, heightPt: number, dpi: number): number {
  const scale = dpi / 72;
  const px = widthPt * scale * (heightPt * scale);
  return px > MAX_RASTER_PIXELS ? scale * Math.sqrt(MAX_RASTER_PIXELS / px) * 0.999 : scale;
}

/** Browser only: renders the original page unrotated at the given DPI. */
export async function rasterizeWithPdfJs(source: SourceFile, pageIndex: number, dpi: number): Promise<{ png: Uint8Array; widthPt: number; heightPt: number }> {
  const { getPage } = await import("../pdf/render");
  const page = await getPage(source, pageIndex);
  const pt = page.getViewport({ scale: 1, rotation: 0 });
  const scale = cappedScale(pt.width, pt.height, dpi);
  const viewport = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) throw new Error("Could not rasterize page");
  // annotationMode 0 (DISABLE): annotations stay as live annotations on the output page, not baked into the raster.
  await page.render({ canvas, canvasContext, viewport, annotationMode: 0 }).promise;
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Could not rasterize page");
  return { png: new Uint8Array(await blob.arrayBuffer()), widthPt: viewport.width / scale, heightPt: viewport.height / scale };
}
