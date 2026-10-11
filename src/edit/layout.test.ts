import { describe, it, expect } from "vitest";
import { layoutBlock, coverBoxes, layoutEdit, placeEdit } from "./layout";
const measure = (t: string, s: number) => t.length * s * 0.5;

describe("layoutBlock", () => {
  const box = { x: 10, y: 100, width: 100, height: 36 }; // 3 lines of 12
  it("wraps words at the block width and places baselines by lineHeight", () => {
    const l = layoutBlock("aaaa bbbb cccc dddd", box, 10, 12, measure); // 20 chars per line max
    expect(l.lines.map((x) => x.text)).toEqual(["aaaa bbbb cccc dddd"]);
    const l2 = layoutBlock("aaaaaaaaaaaa bbbbbbbbbbbb cccccccccccc", box, 10, 12, measure);
    expect(l2.lines.map((x) => x.text)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"]);
    expect(l2.lines[0].baseline).toBeCloseTo(136 - 10);
    expect(l2.lines[1].baseline).toBeCloseTo(136 - 10 - 12);
    expect(l2.boxes[0]).toMatchObject({ x: 10, width: 100, height: 12 });
    expect(l2.boxes[2].height).toBeCloseTo(10.5);
    expect(l2.overflowLines).toBe(0);
  });
  it("tolerates a 3 % overhang on one line but wraps at 10 %", () => {
    const b = { x: 0, y: 0, width: 100, height: 36 };
    const over = (pct: number) => ["aaaa", "b".repeat(Math.round((100 * (1 + pct)) / 5) - 5)].join(" "); // 5 per char at size 10
    const small = layoutBlock(over(0.03), b, 10, 12, measure);
    expect(measure(small.lines[0].text, 10)).toBeGreaterThan(100);
    expect(small.lines).toHaveLength(1);
    expect(small.lines[0].width).toBe(100);
    expect(layoutBlock(over(0.1), b, 10, 12, measure).lines.length).toBeGreaterThan(1);
  });
  it("yields exactly one cover box for a single-line replacement of a single-line block", () => {
    const region = { x: 10, y: 100, width: 100, height: 12 }; // fontSize 10: baseline 102, top = baseline + fontSize
    const lay = layoutBlock("three:9", region, 10, 12, measure);
    expect(lay.lines[0].baseline).toBeCloseTo(102);
    expect(coverBoxes(lay, region)).toHaveLength(1);
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

describe("layoutEdit / placeEdit", () => {
  const base = { text: "one", fontSize: 10, lineHeight: 12, boxes: [{ x: 10, y: 100, width: 100, height: 36 }], region: { x: 10, y: 100, width: 100, height: 36 } };
  it("lays out in the region and covers it when no frame is set", () => {
    const e = layoutEdit(base, measure);
    expect(e.lines[0]).toMatchObject({ text: "one", x: 10, baseline: 126 });
    expect(Math.min(...e.boxes.map((b) => b.y))).toBeCloseTo(100);
  });
  it("lays out in the frame and keeps the original region covered", () => {
    const frame = { x: 200, y: 50, width: 100, height: 36 };
    const e = layoutEdit({ ...base, frame }, measure);
    expect(e.lines[0]).toMatchObject({ x: 200, baseline: 50 + 36 - 10 });
    expect(e.boxes).toContainEqual(base.region);
    expect(e.boxes.some((b) => b.x === 200)).toBe(true);
  });
  it("does not add a sliver box when the remainder is under 0.01pt", () => {
    const region = { x: 0, y: 0, width: 100, height: 12.005 };
    const lay = layoutBlock("a", region, 10, 12, measure);
    expect(coverBoxes(lay, region)).toEqual(lay.boxes);
  });
  it("keeps the per-box layout for legacy edits without a region", () => {
    const legacy = { text: "x", fontSize: 10, boxes: [{ x: 5, y: 50, width: 100, height: 12 }] };
    const p = placeEdit(legacy, measure);
    expect(p.lines[0].baseline).toBeCloseTo(50 + 12 - 8.5);
    expect(p.boxes).toBe(legacy.boxes);
  });
});
