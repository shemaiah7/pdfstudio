import { useCallback, useRef, useState } from "react";
import type { NewAnnotation, RGB } from "../pdf/types";
import type { Tool } from "../store/tools";
import { simplifyStroke, normalizeBox, shapeTooSmall, pointerToPdf, type PageMeta } from "../pdf/geometry";
import { useDocumentStore } from "../store/document";

export interface DrawingState { active: boolean; start: { x: number; y: number } | null; current: { x: number; y: number } | null; points: { x: number; y: number }[] }
export const initialDrawing: DrawingState = { active: false, start: null, current: null, points: [] };
export type DrawEvent = { type: "down"; x: number; y: number } | { type: "move"; x: number; y: number } | { type: "up" };
export interface DrawCtx { pageEntryId: string; color: RGB; width: number; fontSize: number }
export const DRAWING_TOOLS: readonly Tool[] = ["ink", "rect", "arrow", "freetext", "note"];

const MIN_INK_LENGTH = 4;
const polylineLength = (pts: { x: number; y: number }[]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

export function drawingReducer(s: DrawingState, e: DrawEvent, tool: Tool, ctx: DrawCtx): { state: DrawingState; commit?: NewAnnotation } {
  const base = { pageEntryId: ctx.pageEntryId, color: ctx.color };
  if (e.type === "down") {
    if (tool === "note") return { state: initialDrawing, commit: { kind: "note", ...base, x: e.x, y: e.y, text: "" } };
    return { state: { active: true, start: { x: e.x, y: e.y }, current: { x: e.x, y: e.y }, points: [{ x: e.x, y: e.y }] } };
  }
  if (!s.active || !s.start) return { state: s };
  if (e.type === "move") return { state: { ...s, current: { x: e.x, y: e.y }, points: tool === "ink" ? [...s.points, { x: e.x, y: e.y }] : s.points } };
  const st = s.start, cur = s.current ?? s.start;
  const done = { state: initialDrawing };
  switch (tool) {
    case "ink": { const pts = simplifyStroke(s.points); return pts.length < 2 || polylineLength(pts) < MIN_INK_LENGTH ? done : { ...done, commit: { kind: "ink", ...base, strokes: [pts], width: ctx.width } }; }
    case "rect": case "arrow": return shapeTooSmall(st.x, st.y, cur.x, cur.y) ? done : { ...done, commit: { kind: "shape", ...base, shape: tool, x1: st.x, y1: st.y, x2: cur.x, y2: cur.y, width: ctx.width } };
    case "freetext": { const b = normalizeBox(st.x, st.y, cur.x, cur.y); return b.width < 40 || b.height < 16 ? done : { ...done, commit: { kind: "freetext", ...base, box: b, text: "", fontSize: ctx.fontSize } }; }
    default: return done;
  }
}

export function useDrawingTool(pageEntryId: string, meta: PageMeta, pageEl: () => HTMLElement | null, tool: Tool, ctx: Omit<DrawCtx, "pageEntryId">, onCommit?: (id: string, a: NewAnnotation) => void) {
  const [state, setState] = useState<DrawingState>(initialDrawing);
  const ref = useRef(state); ref.current = state;
  const latest = useRef({ tool, ctx, onCommit, pageEntryId }); latest.current = { tool, ctx, onCommit, pageEntryId };
  const dispatch = useCallback((e: DrawEvent) => {
    const { tool: t, ctx: c, onCommit: cb, pageEntryId: pid } = latest.current;
    const r = drawingReducer(ref.current, e, t, { pageEntryId: pid, ...c });
    ref.current = r.state; setState(r.state);
    if (r.commit) {
      const { addAnnotation, selectAnnotation } = useDocumentStore.getState();
      const id = addAnnotation(r.commit);
      if (r.commit.kind === "freetext" || r.commit.kind === "note") selectAnnotation(id);
      cb?.(id, r.commit);
    }
  }, []);
  const toPdf = (ev: { clientX: number; clientY: number }) => { const el = pageEl(); return el ? pointerToPdf(ev, el, meta) : null; };
  const handlers = {
    onPointerDown: (ev: React.PointerEvent) => {
      if (ev.button !== 0) return;
      const p = toPdf(ev); if (!p) return;
      ev.preventDefault();
      (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
      dispatch({ type: "down", ...p });
    },
    onPointerMove: (ev: React.PointerEvent) => { if (!ref.current.active) return; const p = toPdf(ev); if (p) dispatch({ type: "move", ...p }); },
    onPointerUp: () => dispatch({ type: "up" }),
    onPointerCancel: () => { ref.current = initialDrawing; setState(initialDrawing); },
  };
  return { state, handlers };
}
