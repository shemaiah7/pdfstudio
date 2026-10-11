import type { Box } from "./types";
import { localToPdf, type PageMeta } from "./geometry";
export interface PageSelection { pageEntryId: string; text: string; boxes: Box[]; fontSize: number; bold: boolean; serif: boolean }

// Plain rect (DOMRectReadOnly-compatible) so geometry helpers also run without a DOM.
export interface Rect { x: number; y: number; width: number; height: number; left: number; top: number; right: number; bottom: number }

export function mergeLineRects(rects: readonly Rect[]): Rect[] {
  const sorted = [...rects].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(r.top - last.top) < r.height * 0.5) {
      last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right);
      last.top = Math.min(last.top, r.top); last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }
  return lines.map((l) => ({
    x: l.left, y: l.top, width: l.right - l.left, height: l.bottom - l.top,
    left: l.left, top: l.top, right: l.right, bottom: l.bottom,
  }));
}

export function rectsToBoxes(rects: readonly Rect[], pageRect: Rect, scale: number, pageHeightPt: number): Box[] {
  return rects.map((r) => {
    const x = (r.left - pageRect.left) / scale;
    const top = (r.top - pageRect.top) / scale;
    const width = r.width / scale;
    const height = r.height / scale;
    return { x, y: pageHeightPt - top - height, width, height };
  });
}

/** Rotation-aware variant: converts every corner of each rect through localToPdf and takes the bounding box. */
export function rectsToBoxesRotated(rects: readonly Rect[], pageRect: Rect, meta: PageMeta): Box[] {
  return rects.map((r) => {
    const pts = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
      .map(([cx, cy]) => localToPdf(cx - pageRect.left, cy - pageRect.top, meta));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  });
}

export function captureSelection(): PageSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const pageEl = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>(".page");
  if (!pageEl) return null;
  const text = sel.toString().replace(/\s+\n/g, "\n").trim();
  if (!text) return null;
  const scale = Number(pageEl.dataset.scale);
  const heightPt = Number(pageEl.dataset.heightPt);
  if (!Number.isFinite(scale) || !Number.isFinite(heightPt)) return null;
  const rects = mergeLineRects(Array.from(range.getClientRects()));
  if (rects.length === 0) return null;
  const widthPt = Number(pageEl.dataset.widthPt);
  const rot = ((Number(pageEl.dataset.pageRotate ?? 0) + Number(pageEl.dataset.rotation ?? 0)) % 360 + 360) % 360;
  const boxes = Number.isFinite(widthPt) && widthPt > 0 && rot !== 0 && [90, 180, 270].includes(rot)
    ? rectsToBoxesRotated(rects, pageEl.getBoundingClientRect(), { widthPt, heightPt, scale, rotation: rot as 90 | 180 | 270 })
    : rectsToBoxes(rects, pageEl.getBoundingClientRect(), scale, heightPt);
  const anchorEl = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement) as HTMLElement | null;
  const cs = anchorEl ? getComputedStyle(anchorEl) : null;
  const fontSize = cs ? parseFloat(cs.fontSize) / scale : boxes[0].height * 0.85;
  const family = (cs?.fontFamily ?? "").toLowerCase();
  const bold = cs ? Number(cs.fontWeight) >= 600 || /bold/.test(family) : false;
  const serif = /times|serif|georgia|garamond/.test(family) && !/sans/.test(family);
  return { pageEntryId: pageEl.dataset.pageEntry ?? "", text, boxes, fontSize: Math.round(fontSize * 10) / 10, bold, serif };
}
