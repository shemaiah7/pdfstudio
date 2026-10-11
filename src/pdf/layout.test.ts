import { describe, it, expect } from "vitest";
import { layoutText, layoutInBoxes, regionOf } from "./layout";

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

describe("layoutInBoxes", () => {
  // widths at 10pt with 0.5em chars: 80pt = 16 chars, 180pt = 36 chars, 60pt = 12 chars
  const boxes = [
    { x: 20, y: 80, width: 180, height: 14 },
    { x: 120, y: 100, width: 80, height: 14 },
    { x: 20, y: 60, width: 60, height: 14 },
  ];
  it("places each line in its own box, top to bottom", () => {
    const r = layoutInBoxes("aaaa bbbb cccc dddddddd dddddddd dddddddd eeee ffff gggg", boxes, 10, measure);
    expect(r.overflow).toBe(false);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0].x).toBe(120);
    expect(r.lines[1].x).toBe(20);
    expect(r.lines[2].x).toBe(20);
    expect(measure(r.lines[0].text, r.fontSize)).toBeLessThanOrEqual(80);
    expect(measure(r.lines[2].text, r.fontSize)).toBeLessThanOrEqual(60);
    expect(r.lines[0].baseline).toBeCloseTo(100 + 14 - r.fontSize * 0.85);
    expect(r.lines[0].width).toBe(80);
  });
  it("shrinks when it does not fit at full size", () => {
    const text = "a".repeat(16) + " " + "b".repeat(36) + " " + "c".repeat(13); // needs smaller font for the 60pt box
    const r = layoutInBoxes(text, boxes, 10, measure);
    expect(r.fontSize).toBeLessThan(10);
    expect(r.overflow).toBe(false);
  });
  it("reports overflow and returns only the lines that fit", () => {
    const r = layoutInBoxes("a".repeat(400), boxes, 10, measure);
    expect(r.overflow).toBe(true);
    expect(r.fontSize).toBeCloseTo(7);
    expect(r.lines).toHaveLength(3);
  });
  it("keepOverflow returns every line", () => {
    const r = layoutInBoxes("a".repeat(400), boxes, 10, measure, { keepOverflow: true });
    expect(r.overflow).toBe(true);
    expect(r.lines.length).toBeGreaterThan(3);
  });
});
