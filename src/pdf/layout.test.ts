import { describe, it, expect } from "vitest";
import { layoutText, regionOf } from "./layout";

const measure = (t: string, size: number) => t.length * size * 0.5; // 0.5em per char

describe("regionOf", () => {
  it("unions boxes", () => {
    expect(regionOf([{ x: 10, y: 100, width: 50, height: 12 }, { x: 10, y: 86, width: 30, height: 12 }])).toEqual({ x: 10, y: 86, width: 50, height: 26 });
  });
});

describe("layoutText", () => {
  const region = { x: 0, y: 0, width: 100, height: 24 }; // two lines at 10pt
  it("wraps words within the width", () => {
    const r = layoutText("aaaa bbbb cccc dddd", region, 10, measure); // each word 20pt + space 5pt
    expect(r.fontSize).toBe(10);
    expect(r.lines.map((l) => l.text)).toEqual(["aaaa bbbb cccc dddd"]);
    const r2 = layoutText("aaaa bbbb cccc dddd eeee ffff", region, 10, measure);
    expect(r2.lines.length).toBe(2);
    expect(r2.overflow).toBe(false);
  });
  it("shrinks when it does not fit", () => {
    const r = layoutText("aaaa ".repeat(12).trim(), region, 10, measure); // 60 chars → 300pt at 10pt, 3 lines
    expect(r.fontSize).toBeLessThan(10);
    expect(r.overflow).toBe(false);
  });
  it("reports overflow when even 70% does not fit", () => {
    const r = layoutText("a".repeat(400), region, 10, measure);
    expect(r.overflow).toBe(true);
    expect(r.fontSize).toBeCloseTo(7);
  });
  it("places baselines from the top of the region", () => {
    const r = layoutText("hi", { x: 5, y: 100, width: 100, height: 24 }, 10, measure);
    expect(r.lines[0]).toEqual({ text: "hi", x: 5, baseline: 114 });
  });
});
