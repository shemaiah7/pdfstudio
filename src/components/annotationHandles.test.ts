import { describe, it, expect } from "vitest";
import { boundsOf, moveAnnotation, resizeAnnotation } from "./annotationHandles";
import type { Annotation } from "../pdf/types";
const c: [number, number, number] = [0, 0, 0];
describe("handles", () => {
  it("bounds for each kind", () => {
    expect(boundsOf({ id: "1", kind: "shape", pageEntryId: "p", color: c, shape: "arrow", x1: 50, y1: 10, x2: 10, y2: 40, width: 1 })).toEqual({ x: 10, y: 10, width: 40, height: 30 });
    expect(boundsOf({ id: "2", kind: "ink", pageEntryId: "p", color: c, width: 2, strokes: [[{ x: 5, y: 5 }, { x: 15, y: 25 }]] })).toEqual({ x: 5, y: 5, width: 10, height: 20 });
    expect(boundsOf({ id: "3", kind: "note", pageEntryId: "p", color: c, x: 7, y: 8, text: "" })).toEqual({ x: 7, y: 8, width: 20, height: 20 });
  });
  it("moves every kind", () => {
    const ink = moveAnnotation({ id: "2", kind: "ink", pageEntryId: "p", color: c, width: 2, strokes: [[{ x: 5, y: 5 }]] }, 10, -3) as Extract<Annotation, { kind: "ink" }>;
    expect(ink.strokes[0][0]).toEqual({ x: 15, y: 2 });
    const hl = moveAnnotation({ id: "4", kind: "highlight", pageEntryId: "p", color: c, boxes: [{ x: 0, y: 0, width: 1, height: 1 }] }, 2, 2) as Extract<Annotation, { kind: "highlight" }>;
    expect(hl.boxes[0]).toMatchObject({ x: 2, y: 2 });
  });
  it("resizes boxes from the se handle with a minimum size", () => {
    const ft = resizeAnnotation({ id: "5", kind: "freetext", pageEntryId: "p", color: c, box: { x: 10, y: 10, width: 100, height: 40 }, text: "t", fontSize: 12 }, "se", 20, -10) as Extract<Annotation, { kind: "freetext" }>;
    expect(ft.box).toEqual({ x: 10, y: 0, width: 120, height: 50 });
    const tiny = resizeAnnotation(ft, "se", -500, 500) as Extract<Annotation, { kind: "freetext" }>;
    expect(tiny.box.width).toBe(8); expect(tiny.box.height).toBe(8);
  });
  it("keeps thin shapes straight and still clamps normal ones", () => {
    const arrow = resizeAnnotation({ id: "6", kind: "shape", pageEntryId: "p", color: c, shape: "arrow", x1: 10, y1: 50, x2: 110, y2: 50, width: 1 }, "se", 20, 0) as Extract<Annotation, { kind: "shape" }>;
    expect(arrow.x2).toBe(130); expect(arrow.y1).toBe(50); expect(arrow.y2).toBe(50);
    const rect = resizeAnnotation({ id: "7", kind: "shape", pageEntryId: "p", color: c, shape: "rect", x1: 10, y1: 10, x2: 110, y2: 50, width: 1 }, "se", -500, 500) as Extract<Annotation, { kind: "shape" }>;
    expect(Math.abs(rect.x2 - rect.x1)).toBe(8); expect(Math.abs(rect.y2 - rect.y1)).toBe(8);
  });
});
