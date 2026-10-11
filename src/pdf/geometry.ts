import type { Box } from "./types";
export interface PageMeta { widthPt: number; heightPt: number; scale: number; rotation: 0 | 90 | 180 | 270 }

// Inverse of overlayTransform: rotated-box px -> unrotated-box px.
function unrotate(lx: number, ly: number, m: PageMeta) {
  const W = m.widthPt * m.scale, H = m.heightPt * m.scale;
  switch (m.rotation) {
    case 90: return { x: ly, y: H - lx };
    case 180: return { x: W - lx, y: H - ly };
    case 270: return { x: W - ly, y: lx };
    default: return { x: lx, y: ly };
  }
}
function rotate(x: number, y: number, m: PageMeta) {
  const W = m.widthPt * m.scale, H = m.heightPt * m.scale;
  switch (m.rotation) {
    case 90: return { lx: H - y, ly: x };
    case 180: return { lx: W - x, ly: H - y };
    case 270: return { lx: y, ly: W - x };
    default: return { lx: x, ly: y };
  }
}
export function localToPdf(lx: number, ly: number, m: PageMeta) {
  const u = unrotate(lx, ly, m);
  return { x: u.x / m.scale, y: m.heightPt - u.y / m.scale };
}
export function pdfToLocal(x: number, y: number, m: PageMeta) {
  return rotate(x * m.scale, (m.heightPt - y) * m.scale, m);
}
export function pointerToPdf(e: { clientX: number; clientY: number }, pageEl: HTMLElement, m: PageMeta) {
  const r = pageEl.getBoundingClientRect();
  return localToPdf(e.clientX - r.left, e.clientY - r.top, m);
}
export function simplifyStroke(pts: { x: number; y: number }[], minDist = 1.5) {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  const last = pts[pts.length - 1];
  if (last && out[out.length - 1] !== last && out.length > 1) out[out.length - 1] = last;
  return out;
}
export function normalizeBox(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
export function shapeTooSmall(x1: number, y1: number, x2: number, y2: number, min = 4) {
  return Math.abs(x2 - x1) < min && Math.abs(y2 - y1) < min;
}
