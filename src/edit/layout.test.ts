import { describe, it, expect } from "vitest";
import { layoutBlock } from "./layout";
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
