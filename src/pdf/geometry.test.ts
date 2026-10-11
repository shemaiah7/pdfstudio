import { describe, it, expect } from "vitest";
import { localToPdf, pdfToLocal, simplifyStroke, normalizeBox, shapeTooSmall } from "./geometry";

const m = (rotation: 0 | 90 | 180 | 270) => ({ widthPt: 300, heightPt: 400, scale: 2, rotation });

describe("local <-> pdf", () => {
  it("rotation 0: origin bottom-left, y flipped", () => {
    expect(localToPdf(20, 760, m(0))).toEqual({ x: 10, y: 20 });
    expect(pdfToLocal(10, 20, m(0))).toEqual({ lx: 20, ly: 760 });
  });
  it("round-trips at every rotation", () => {
    for (const r of [0, 90, 180, 270] as const) {
      const p = pdfToLocal(37, 123, m(r));
      const back = localToPdf(p.lx, p.ly, m(r));
      expect(back.x).toBeCloseTo(37); expect(back.y).toBeCloseTo(123);
    }
  });
  it("rotation 90 maps the unrotated top-left to the rotated top-right", () => {
    // unrotated top-left = PDF (0, 400); rotated page box is 800x600 px; pdf.js rotates clockwise
    expect(pdfToLocal(0, 400, m(90))).toEqual({ lx: 800, ly: 0 });
    expect(pdfToLocal(0, 0, m(90))).toEqual({ lx: 0, ly: 0 });
  });
});

describe("simplifyStroke", () => {
  it("drops points closer than minDist and keeps the last point", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 2, y: 0 }, { x: 2.5, y: 0.2 }, { x: 9, y: 9 }];
    expect(simplifyStroke(pts)).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 9, y: 9 }]);
  });
});

describe("shapes", () => {
  it("normalizes and detects tiny shapes", () => {
    expect(normalizeBox(10, 30, 4, 2)).toEqual({ x: 4, y: 2, width: 6, height: 28 });
    expect(shapeTooSmall(0, 0, 3, 3)).toBe(true);
    expect(shapeTooSmall(0, 0, 3, 50)).toBe(false);
  });
});
