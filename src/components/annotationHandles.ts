import type { Annotation, Box } from "../pdf/types";
export type Handle = "nw" | "ne" | "sw" | "se";
export function boundsOf(a: Annotation): Box {
  switch (a.kind) {
    case "highlight": { const xs = a.boxes.map((b) => b.x), ys = a.boxes.map((b) => b.y); const xe = a.boxes.map((b) => b.x + b.width), ye = a.boxes.map((b) => b.y + b.height); return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xe) - Math.min(...xs), height: Math.max(...ye) - Math.min(...ys) }; }
    case "note": return { x: a.x, y: a.y, width: 20, height: 20 };
    case "ink": { const pts = a.strokes.flat(); const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }; }
    case "shape": return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), width: Math.abs(a.x2 - a.x1), height: Math.abs(a.y2 - a.y1) };
    case "freetext": case "signature": return { ...a.box };
  }
}
export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case "highlight": return { ...a, boxes: a.boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })) };
    case "note": return { ...a, x: a.x + dx, y: a.y + dy };
    case "ink": return { ...a, strokes: a.strokes.map((s) => s.map((p) => ({ x: p.x + dx, y: p.y + dy }))) };
    case "shape": return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case "freetext": case "signature": return { ...a, box: { ...a.box, x: a.box.x + dx, y: a.box.y + dy } };
  }
}
function resizeBox(b: Box, h: Handle, dx: number, dy: number, minW: number, minH = minW): Box {
  let { x, y, width, height } = b;
  if (h.includes("e")) width += dx; else { x += dx; width -= dx; }
  if (h.includes("n")) height += dy; else { y += dy; height -= dy; }
  if (width < minW) { if (!h.includes("e")) x = b.x + b.width - minW; width = minW; }
  if (height < minH) { if (!h.includes("n")) y = b.y + b.height - minH; height = minH; }
  return { x, y, width, height };
}
export function resizeAnnotation(a: Annotation, h: Handle, dx: number, dy: number, min = 8): Annotation {
  if (a.kind === "freetext" || a.kind === "signature") return { ...a, box: resizeBox(a.box, h, dx, dy, min) };
  if (a.kind === "shape") { const ob = boundsOf(a); const b = resizeBox(ob, h, dx, dy, ob.width >= min ? min : 0, ob.height >= min ? min : 0); const flipX = a.x2 < a.x1, flipY = a.y2 < a.y1; return { ...a, x1: flipX ? b.x + b.width : b.x, x2: flipX ? b.x : b.x + b.width, y1: flipY ? b.y + b.height : b.y, y2: flipY ? b.y : b.y + b.height }; }
  return a;
}
