import { describe, it, expect } from "vitest";
import { linesFrom, blocksFrom, blockAt, blockKeyOf } from "./blocks";
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
