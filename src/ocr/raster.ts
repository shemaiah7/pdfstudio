import type { SourceFile } from "../pdf/types";
import { getPage } from "../pdf/render";
import type { PageMetaPt } from "./types";

export const TESSERACT_MAX_EDGE = 2500;
export const CLAUDE_MAX_EDGE = 1568;

export function rasterScale(meta: PageMetaPt, maxEdge: number): number {
  return Math.min(300 / 72, maxEdge / Math.max(meta.widthPt, meta.heightPt));
}

/** Renders the unrotated page to a canvas (same frame as pdf.js text content). Resulting OCR boxes are relative to the crop-box origin (pdf.js page.view), not absolute user space. */
export async function rasterizePage(source: SourceFile, pageIndex: number, maxEdge: number): Promise<{ canvas: HTMLCanvasElement; meta: PageMetaPt; scale: number }> {
  const page = await getPage(source, pageIndex);
  const meta = { widthPt: page.view[2] - page.view[0], heightPt: page.view[3] - page.view[1] };
  const scale = rasterScale(meta, maxEdge);
  const viewport = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent "print": pdf.js paces default-intent renders with requestAnimationFrame, which Chrome
  // suspends in hidden tabs, so OCR of a background tab would hang until the queue timeout.
  await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;
  return { canvas, meta, scale };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality));
}
