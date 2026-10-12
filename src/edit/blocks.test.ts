import { describe, it, expect } from "vitest";
import { linesFrom, blocksFrom, blockAt, blockKeyOf, linesInBox, lineAt, lineBox } from "./blocks";
import type { TextItemBox } from "../pdf/text";

const it_ = (str: string, x: number, y: number, w: number, size = 10, fontName = "f1"): TextItemBox => ({ str, x, y, width: w, height: size, fontSize: size, fontName });

describe("linesFrom", () => {
  it("groups by baseline within half the font size and joins with spaces by gap", () => {
    const lines = linesFrom([it_("world", 60, 700, 30), it_("Hello", 10, 702, 40), it_("Next", 10, 686, 30)]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world", "Next"]);
    expect(lines[0]).toMatchObject({ x: 10, baseline: 700, width: 80 });
  });
});

describe("blocksFrom", () => {
  const para = (y0: number, n: number, x = 10, fontName = "f1", size = 10) => Array.from({ length: n }, (_, i) => it_(`l${y0}-${i}`, x, y0 - i * 12, 100, size, fontName));
  it("joins consecutive lines with the same left edge, small gap, same font", () => {
    const blocks = blocksFrom(linesFrom([...para(700, 3)]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(3);
    expect(blocks[0].lineHeight).toBeCloseTo(12);
    expect(blocks[0].text).toBe("l700-0\nl700-1\nl700-2");
    expect(blocks[0].box).toMatchObject({ x: 10, width: 100 });
    expect(blocks[0].box.y).toBeCloseTo(700 - 24 - 2.5);
    expect(blocks[0].box.height).toBeCloseTo(24 + 2.5 + 10);
  });
  it("splits on a large gap, a different left edge, or a different font", () => {
    const items = [...para(700, 2), ...para(640, 2), ...para(600, 2, 40), ...para(560, 2, 10, "f2")];
    const blocks = blocksFrom(linesFrom(items));
    expect(blocks.map((b) => b.lines.length)).toEqual([2, 2, 2, 2]);
    expect(blocks[1].firstLineIndex).toBe(2);
  });
  it("splits when the font size differs by more than 10 %", () => {
    const blocks = blocksFrom(linesFrom([it_("big", 10, 700, 50, 20), it_("small", 10, 676, 50, 10)]));
    expect(blocks).toHaveLength(2);
    expect(blocks[1].lineHeight).toBeCloseTo(12);
  });
  it("forms blocks from OCR items", () => {
    const blocks = blocksFrom(linesFrom([it_("Patient", 36, 350, 40, 14, "ocr"), it_("Jane", 80, 350, 30, 14, "ocr"), it_("Dx", 36, 336, 20, 14, "ocr")]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fontName).toBe("ocr");
    expect(blocks[0].text).toBe("Patient Jane\nDx");
  });
});

describe("blockAt / blockKeyOf", () => {
  it("finds the block containing a point with 2pt tolerance", () => {
    const blocks = blocksFrom(linesFrom([it_("a", 10, 700, 100), it_("b", 10, 600, 100)]));
    expect(blockAt(blocks, 50, 705)?.text).toBe("a");
    expect(blockAt(blocks, 111.5, 600)?.text).toBe("b");
    expect(blockAt(blocks, 50, 650)).toBeUndefined();
    expect(blockKeyOf("s", 2, blocks[1])).toBe("s:2:1");
  });
});

describe("linesFrom columns and runs", () => {
  it("splits a baseline group at gaps wider than 1.2 em", () => {
    const lines = linesFrom([it_("Type", 20, 700, 24), it_("Fall", 48, 700, 20), it_("Finger", 300, 700, 36), it_("Stick", 340, 700, 30)]);
    expect(lines.map((l) => l.text)).toEqual(["Type Fall", "Finger Stick"]);
    expect(lines[0]).toMatchObject({ x: 20, width: 48 });
    expect(lines[1]).toMatchObject({ x: 300, width: 70 });
  });
  it("keeps a normal word gap on one line", () => {
    const lines = linesFrom([it_("Hello", 10, 700, 40), it_("world", 53, 700, 40)]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world"]);
  });
  it("merges consecutive items with the same font and size into runs", () => {
    const lines = linesFrom([it_("Assigned", 20, 700, 40, 10, "bold"), it_(" Caregiver", 60, 700, 50, 10, "bold"), it_("Rylee", 115, 700, 30, 10, "reg"), it_(" Lyons", 145, 700, 30, 10.1, "reg")]);
    expect(lines).toHaveLength(1);
    expect(lines[0].runs.map((r) => [r.text, r.fontName])).toEqual([["Assigned Caregiver", "bold"], ["Rylee Lyons", "reg"]]);
    expect(lines[0].runs[0]).toMatchObject({ x: 20, width: 90 });
  });
  it("starts a new run when the size differs by more than 2 %", () => {
    const lines = linesFrom([it_("A", 10, 700, 10, 10, "f"), it_("B", 20, 700, 10, 12, "f")]);
    expect(lines[0].runs).toHaveLength(2);
  });
  it("exposes a line box from baseline and font size", () => {
    const [line] = linesFrom([it_("x", 10, 700, 20, 10)]);
    expect(lineBox(line)).toEqual({ x: 10, y: 697.5, width: 20, height: 12 });
    expect(line.box).toEqual(lineBox(line));
  });
});

describe("linesInBox and lineAt", () => {
  const lines = linesFrom([it_("Left1", 20, 700, 40), it_("Right1", 300, 700, 40), it_("Left2", 20, 686, 40), it_("Right2", 300, 686, 40)]);
  it("selects lines overlapping the box by half their height and half a glyph", () => {
    expect(linesInBox(lines, { x: 10, y: 680, width: 100, height: 30 }).map((l) => l.text)).toEqual(["Left1", "Left2"]);
    expect(linesInBox(lines, { x: 10, y: 697, width: 100, height: 10 }).map((l) => l.text)).toEqual(["Left1"]);
    expect(linesInBox(lines, { x: 10, y: 710, width: 100, height: 2 })).toEqual([]);
  });
  it("finds the line under a point with a 2 pt tolerance", () => {
    expect(lineAt(lines, 25, 701)?.text).toBe("Left1");
    expect(lineAt(lines, 305, 687)?.text).toBe("Right2");
    expect(lineAt(lines, 200, 700)).toBeUndefined();
  });
});
