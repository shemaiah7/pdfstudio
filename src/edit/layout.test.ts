import { describe, it, expect } from "vitest";
import { layoutBlock, coverBoxes } from "./layout";
const measure = (t: string, s: number) => t.length * s * 0.5;

describe("layoutBlock", () => {
  const box = { x: 10, y: 100, width: 100, height: 36 }; // 3 lines of 12
  it("wraps words at the block width and places baselines by lineHeight", () => {
    const l = layoutBlock("aaaa bbbb cccc dddd", box, 10, 12, measure); // 20 chars per line max
    expect(l.lines.map((x) => x.text)).toEqual(["aaaa bbbb cccc dddd"]);
    const l2 = layoutBlock("aaaaaaaaaa bbbbbbbbbb cccccccccc", box, 10, 12, measure);
    expect(l2.lines.map((x) => x.text)).toEqual(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"]);
    expect(l2.lines[0].baseline).toBeCloseTo(136 - 8);
    expect(l2.lines[1].baseline).toBeCloseTo(136 - 8 - 12);
    expect(l2.boxes[0]).toMatchObject({ x: 10, width: 100, height: 12 });
    expect(l2.boxes[2].height).toBeCloseTo(10.5);
    expect(l2.overflowLines).toBe(0);
  });
  it("breaks on newlines and reports overflow", () => {
    const l = layoutBlock("a\nb\nc\nd", box, 10, 12, measure);
    expect(l.lines).toHaveLength(4);
    expect(l.overflowLines).toBe(1);
    expect(l.height).toBeCloseTo(48);
  });
});

describe("coverBoxes", () => {
  const region = { x: 10, y: 100, width: 100, height: 36 };
  it("covers the whole region when the text shrinks", () => {
    const boxes = coverBoxes(layoutBlock("one", region, 10, 12, measure), region);
    expect(boxes).toHaveLength(2);
    expect(Math.min(...boxes.map((b) => b.y))).toBeCloseTo(100);
    expect(Math.max(...boxes.map((b) => b.y + b.height))).toBeGreaterThanOrEqual(136 - 2);
    const sorted = [...boxes].sort((a, b) => a.y - b.y);
    expect(sorted[0].y + sorted[0].height).toBeGreaterThanOrEqual(sorted[1].y - 1e-9);
  });
  it("returns only the layout boxes when the text fills or exceeds the region", () => {
    const l = layoutBlock("a\nb\nc\nd", region, 10, 12, measure);
    expect(coverBoxes(l, region)).toEqual(l.boxes);
  });
});
