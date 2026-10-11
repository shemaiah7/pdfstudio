import { PDFArray, PDFName, PDFRef, type PDFDocument, type PDFFont, type PDFObject, type PDFPage } from "pdf-lib";
import { addInvisibleText } from "../ocr/textLayer";
import type { OcrLine, OcrPage } from "../ocr/types";
import type { TextItemBox } from "../pdf/text";
import type { Box, RGB, SourceFile } from "../pdf/types";
import { linesFrom } from "./blocks";

export interface FlattenInput {
  png: Uint8Array; widthPt: number; heightPt: number;
  /** Edited extracted items, crop-relative. */
  items: TextItemBox[];
  cropOrigin: { x: number; y: number };
}

export function itemsToOcrPage(items: TextItemBox[]): OcrPage {
  const lines: OcrLine[] = linesFrom(items).map((l) => {
    // OCR items already carry a tight box whose y is its bottom; native items sit on a baseline and get padded.
    const words = l.items.map((i) => ({ text: i.str, confidence: 1, box: i.fontName === "ocr" ? { x: i.x, y: i.y, width: i.width, height: i.height } : { x: i.x, y: i.y - 0.25 * i.fontSize, width: i.width, height: 1.2 * i.fontSize } }));
    const x = Math.min(...words.map((w) => w.box.x)), y = Math.min(...words.map((w) => w.box.y));
    const right = Math.max(...words.map((w) => w.box.x + w.box.width)), top = Math.max(...words.map((w) => w.box.y + w.box.height));
    return { text: l.text, box: { x, y, width: right - x, height: top - y }, words };
  });
  return { engine: "tesseract", lines, confidence: 1, at: 0 };
}

/** Page internals pdf-lib caches when drawing; reset when a flatten attempt is rolled back. */
type PageInternals = { contentStream?: unknown; contentStreamRef?: unknown };

/** Deletes the content stream object(s) behind a raw `/Contents` value (a ref, an array of refs, or a ref to an array). */
function deleteContents(doc: PDFDocument, value: PDFObject | undefined): void {
  const shared = new Set<PDFObject>([doc.context.getPushGraphicsStateContentStream(), doc.context.getPopGraphicsStateContentStream()]); // wrappers pdf-lib shares between pages
  const walk = (v: PDFObject | undefined) => {
    if (v instanceof PDFArray) { for (let i = 0; i < v.size(); i++) walk(v.get(i)); return; }
    if (!(v instanceof PDFRef) || shared.has(v)) return;
    const target = doc.context.lookup(v);
    if (target instanceof PDFArray) walk(target);
    doc.context.delete(v);
  };
  walk(value);
}

/**
 * Replaces the page's content with a raster of the original, then (via drawEdits) the edit covers and text,
 * then an invisible text layer, so text hidden under an edit cannot be extracted from the output.
 * The original content streams are deleted from the document; if anything fails the page is restored untouched.
 */
export async function flattenPage(doc: PDFDocument, page: PDFPage, input: FlattenInput, font: PDFFont, drawEdits?: () => Promise<void> | void): Promise<void> {
  const image = await doc.embedPng(input.png); // before clearing, so a bad raster leaves the page intact for the caller's fallback
  const CONTENTS = PDFName.of("Contents"), RESOURCES = PDFName.of("Resources");
  const oldContents = page.node.get(CONTENTS);
  const oldResources = page.node.get(RESOURCES);
  try {
    page.node.set(CONTENTS, doc.context.register(doc.context.flateStream("")));
    page.node.set(RESOURCES, doc.context.obj({})); // nothing from the original page may stay reachable
    const crop = page.getCropBox();
    page.drawImage(image, { x: crop.x, y: crop.y, width: crop.width, height: crop.height });
    await drawEdits?.();
    addInvisibleText(page, font, itemsToOcrPage(input.items), input.cropOrigin);
  } catch (err) {
    if (oldContents) page.node.set(CONTENTS, oldContents); else page.node.delete(CONTENTS);
    if (oldResources) page.node.set(RESOURCES, oldResources); else page.node.delete(RESOURCES);
    const internals = page as unknown as PageInternals;
    internals.contentStream = undefined; internals.contentStreamRef = undefined; // so later drawing targets the restored /Contents
    throw err;
  }
  deleteContents(doc, oldContents);
}

/** Paints the edit covers onto a raster canvas (crop-relative points, y up) in their background colour. */
export interface RasterCover { box: Box; color: RGB }
export function paintCovers(ctx: { fillStyle: string | CanvasGradient | CanvasPattern; fillRect(x: number, y: number, w: number, h: number): void }, covers: RasterCover[], scale: number, heightPt: number): void {
  for (const { box, color } of covers) {
    ctx.fillStyle = `rgb(${color.map((c) => Math.round(c * 255)).join(",")})`;
    const left = Math.floor(box.x * scale), top = Math.floor((heightPt - box.y - box.height) * scale);
    const right = Math.ceil((box.x + box.width) * scale), bottom = Math.ceil((heightPt - box.y) * scale);
    ctx.fillRect(left, top, right - left, bottom - top);
  }
}

export const MAX_RASTER_PIXELS = 16_000_000;
/** Scale (px per pt) for the requested DPI, reduced so widthPx * heightPx stays within MAX_RASTER_PIXELS. */
export function cappedScale(widthPt: number, heightPt: number, dpi: number): number {
  const scale = dpi / 72;
  const px = widthPt * scale * (heightPt * scale);
  return px > MAX_RASTER_PIXELS ? scale * Math.sqrt(MAX_RASTER_PIXELS / px) * 0.999 : scale;
}

/** Browser only: renders the original page unrotated at the given DPI. */
export async function rasterizeWithPdfJs(source: SourceFile, pageIndex: number, dpi: number, covers: RasterCover[] = []): Promise<{ png: Uint8Array; widthPt: number; heightPt: number }> {
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
  paintCovers(canvasContext, covers, scale, viewport.height / scale); // before encoding, so the PNG never carries the covered pixels
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Could not rasterize page");
  return { png: new Uint8Array(await blob.arrayBuffer()), widthPt: viewport.width / scale, heightPt: viewport.height / scale };
}
