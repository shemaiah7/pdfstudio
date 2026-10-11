import { describe, it, expect } from "vitest";
import { drawingReducer, initialDrawing } from "./useDrawingTool";
const ctx = { pageEntryId: "p", color: [1, 0, 0] as [number, number, number], width: 2.5, fontSize: 12 };
describe("drawingReducer", () => {
  it("ink: collects simplified points and commits a stroke with >= 2 points", () => {
    let s = initialDrawing;
    s = drawingReducer(s, { type: "down", x: 0, y: 0 }, "ink", ctx).state;
    s = drawingReducer(s, { type: "move", x: 0.5, y: 0 }, "ink", ctx).state;
    s = drawingReducer(s, { type: "move", x: 10, y: 10 }, "ink", ctx).state;
    const r = drawingReducer(s, { type: "up" }, "ink", ctx);
    expect(r.commit).toMatchObject({ kind: "ink", strokes: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]], width: 2.5 });
  });
  it("ink: a tap commits nothing", () => {
    const s = drawingReducer(initialDrawing, { type: "down", x: 0, y: 0 }, "ink", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "ink", ctx).commit).toBeUndefined();
  });
  it("ink: a near-dot stroke (< 4pt long after simplification) commits nothing", () => {
    let s = drawingReducer(initialDrawing, { type: "down", x: 0, y: 0 }, "ink", ctx).state;
    s = drawingReducer(s, { type: "move", x: 1.6, y: 0 }, "ink", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "ink", ctx).commit).toBeUndefined();
  });
  it("rect: discards tiny drags, commits otherwise", () => {
    let s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 10 }, "rect", ctx).state;
    s = drawingReducer(s, { type: "move", x: 12, y: 12 }, "rect", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "rect", ctx).commit).toBeUndefined();
    s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 10 }, "arrow", ctx).state;
    s = drawingReducer(s, { type: "move", x: 60, y: 40 }, "arrow", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "arrow", ctx).commit).toMatchObject({ kind: "shape", shape: "arrow", x1: 10, y1: 10, x2: 60, y2: 40 });
  });
  it("freetext: requires a 40x16 box and commits with empty text for editing", () => {
    let s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 100 }, "freetext", ctx).state;
    s = drawingReducer(s, { type: "move", x: 30, y: 90 }, "freetext", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "freetext", ctx).commit).toBeUndefined();
    s = drawingReducer(initialDrawing, { type: "down", x: 10, y: 100 }, "freetext", ctx).state;
    s = drawingReducer(s, { type: "move", x: 100, y: 60 }, "freetext", ctx).state;
    expect(drawingReducer(s, { type: "up" }, "freetext", ctx).commit).toMatchObject({ kind: "freetext", box: { x: 10, y: 60, width: 90, height: 40 }, text: "", fontSize: 12 });
  });
  it("note: commits on down", () => {
    expect(drawingReducer(initialDrawing, { type: "down", x: 5, y: 6 }, "note", ctx).commit).toMatchObject({ kind: "note", x: 5, y: 6, text: "" });
  });
});
