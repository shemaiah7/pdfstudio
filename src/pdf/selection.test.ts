import { describe, it, expect } from "vitest";
import { mergeLineRects, rectsToBoxes } from "./selection";

const r = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON() {} }) as DOMRect;

describe("mergeLineRects", () => {
  it("merges rects on one line and keeps separate lines separate, covering only selected glyphs", () => {
    const merged = mergeLineRects([r(10, 100, 40, 12), r(50, 100, 60, 12), r(10, 116, 30, 12)]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ x: 10, y: 100, width: 100, height: 12 });
    expect(merged[1]).toMatchObject({ x: 10, y: 116, width: 30, height: 12 });
  });
});

describe("rectsToBoxes", () => {
  it("converts CSS px rects to PDF points with origin bottom-left", () => {
    const page = r(100, 200, 600, 800); // page element on screen at scale 2 (300x400pt)
    const boxes = rectsToBoxes([r(120, 220, 60, 24)], page, 2, 400);
    expect(boxes[0]).toEqual({ x: 10, y: 400 - 10 - 12, width: 30, height: 12 });
  });
});

import { rectsToBoxesRotated } from "./selection";
describe("rectsToBoxesRotated", () => {
  it("maps a top-left rect on a 90-degree rotated page to the unrotated bottom-left region", () => {
    const pageRect = { x: 0, y: 0, width: 400, height: 300, left: 0, top: 0, right: 400, bottom: 300 };
    const r = { x: 0, y: 0, width: 50, height: 20, left: 0, top: 0, right: 50, bottom: 20 };
    const [b] = rectsToBoxesRotated([r], pageRect, { widthPt: 300, heightPt: 400, scale: 1, rotation: 90 });
    expect(b.x).toBeCloseTo(0); expect(b.y).toBeCloseTo(0); expect(b.width).toBeCloseTo(20); expect(b.height).toBeCloseTo(50);
  });
});
