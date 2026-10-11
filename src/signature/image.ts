import type { Box } from "../pdf/types";

export function whiteToTransparent(imageData: ImageData, threshold = 235): ImageData {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= threshold && d[i + 1] >= threshold && d[i + 2] >= threshold) d[i + 3] = 0;
  }
  return imageData;
}

export function fitSignature(pngWidth: number, pngHeight: number, pageWidthPt: number): Box {
  const width = 0.3 * pageWidthPt;
  return { x: 0, y: 0, width, height: pngWidth > 0 ? (width * pngHeight) / pngWidth : 0 };
}

/** Crop transparent margins; falls back to the source canvas if pixels are unreadable or empty. */
export function trimToPng(canvas: HTMLCanvasElement): string {
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.getImageData !== "function") return canvas.toDataURL("image/png");
    const { width, height } = canvas;
    const d = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return canvas.toDataURL("image/png");
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext("2d")!.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  } catch { return canvas.toDataURL("image/png"); }
}

export function scaledSize(w: number, h: number, max = 1200): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
