import type { OcrResponse } from "../ai/client";
import { linesToOcrPage } from "./layout";
import { canvasToBlob } from "./raster";
import type { OcrEngine, OcrPage, PageMetaPt } from "./types";

export interface OcrApi { runOcr(pages: { page: number; image: string }[], signal?: AbortSignal): Promise<OcrResponse> }
export const JPEG_QUALITY = 0.85;
export const MAX_JPEG_BYTES = 4_000_000;
const FALLBACK_EDGES = [1200, 900];

export function downscale(c: HTMLCanvasElement, edge: number): HTMLCanvasElement {
  const k = edge / Math.max(c.width, c.height);
  const out = document.createElement("canvas");
  out.width = Math.round(c.width * k); out.height = Math.round(c.height * k);
  out.getContext("2d")!.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function encodeJpeg(canvas: HTMLCanvasElement, shrink: (c: HTMLCanvasElement, edge: number) => HTMLCanvasElement = downscale): Promise<string> {
  let current = canvas;
  let blob = await canvasToBlob(current, "image/jpeg", JPEG_QUALITY);
  for (const edge of FALLBACK_EDGES) {
    if (blob.size <= MAX_JPEG_BYTES) break;
    current = shrink(current, edge);
    blob = await canvasToBlob(current, "image/jpeg", JPEG_QUALITY);
  }
  if (blob.size > MAX_JPEG_BYTES) throw new Error("Page image too large");
  return toBase64(blob);
}

export function createClaudeEngine(api: () => OcrApi | null, opts: { onQuota?: (r: Pick<OcrResponse, "remaining" | "resetAt">) => void } = {}): OcrEngine {
  return {
    async recognize(canvas: HTMLCanvasElement, meta: PageMetaPt, signal?: AbortSignal): Promise<OcrPage> {
      const a = api();
      if (!a) throw new Error("not configured");
      const image = await encodeJpeg(canvas);
      if (signal?.aborted) throw new Error("cancelled");
      const r = await a.runOcr([{ page: 1, image }], signal);
      opts.onQuota?.({ remaining: r.remaining, resetAt: r.resetAt });
      const got = r.pages.find((p) => p.page === 1);
      if (!got) throw new Error("upstream");
      return linesToOcrPage(got.lines, meta);
    },
  };
}
