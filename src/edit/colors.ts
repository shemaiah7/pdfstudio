import type { Box, RGB } from "../pdf/types";
export interface PixelRect { x: number; y: number; width: number; height: number }
const Q = 16;
const WHITE: RGB = [1, 1, 1], BLACK: RGB = [0, 0, 0];

export function sampleColors(image: ImageData, rect: PixelRect, ring = 3): { background: RGB; text: RGB } {
  const { width: W, height: H, data } = image;
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(W, Math.ceil(rect.x + rect.width)), y1 = Math.min(H, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return { background: WHITE, text: BLACK };
  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number]>();
  const px = (x: number, y: number) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]] as const; };
  for (let y = Math.max(0, y0 - ring); y < Math.min(H, y1 + ring); y++) for (let x = Math.max(0, x0 - ring); x < Math.min(W, x1 + ring); x++) {
    if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
    const [r, g, b] = px(x, y);
    const key = (Math.floor(r / Q) << 8) | (Math.floor(g / Q) << 4) | Math.floor(b / Q);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const s = sums.get(key) ?? [0, 0, 0]; s[0] += r; s[1] += g; s[2] += b; sums.set(key, s);
  }
  let background = WHITE;
  if (counts.size) {
    const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const n = counts.get(key)!, s = sums.get(key)!;
    background = [s[0] / n / 255, s[1] / n / 255, s[2] / n / 255];
  }
  const inside: [number, number, number, number][] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const [r, g, b] = px(x, y); inside.push([r + g + b, r, g, b]); }
  if (!inside.length) return { background, text: BLACK };
  inside.sort((a, b) => a[0] - b[0]);
  const n = Math.max(1, Math.floor(inside.length * 0.05));
  const sum = [0, 0, 0];
  for (const [, r, g, b] of inside.slice(0, n)) { sum[0] += r; sum[1] += g; sum[2] += b; }
  return { background, text: [sum[0] / n / 255, sum[1] / n / 255, sum[2] / n / 255] };
}

export function sampleBlockColors(canvas: HTMLCanvasElement, box: Box, scale: number, heightPt: number): { background: RGB; text: RGB } {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { background: WHITE, text: BLACK };
    const ratio = canvas.width / (parseFloat(canvas.style.width) || canvas.width);
    const rect = { x: box.x * scale * ratio, y: (heightPt - box.y - box.height) * scale * ratio, width: box.width * scale * ratio, height: box.height * scale * ratio };
    const pad = 3 * ratio;
    const img = ctx.getImageData(Math.max(0, rect.x - pad), Math.max(0, rect.y - pad), rect.width + 2 * pad, rect.height + 2 * pad);
    return sampleColors(img, { x: Math.min(pad, rect.x), y: Math.min(pad, rect.y), width: rect.width, height: rect.height }, pad);
  } catch { return { background: WHITE, text: BLACK }; }
}
