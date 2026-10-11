import { describe, it, expect } from "vitest";
import { tesseractToOcrPage, linesToOcrPage, ocrPageToItems, ocrPageText, isEmptyOcr } from "./layout";

describe("tesseractToOcrPage", () => {
  it("divides pixel boxes by scale and flips y to bottom-left origin", () => {
    const page = tesseractToOcrPage(
      [{ text: "Hello world", bbox: { x0: 20, y0: 40, x1: 220, y1: 80 },
         words: [{ text: "Hello", bbox: { x0: 20, y0: 40, x1: 100, y1: 80 }, confidence: 95 }, { text: "world", bbox: { x0: 120, y0: 40, x1: 220, y1: 80 }, confidence: 85 }] }],
      88, 2, 400, 123);
    expect(page.engine).toBe("tesseract");
    expect(page.at).toBe(123);
    expect(page.confidence).toBeCloseTo(0.88);
    expect(page.lines[0].box).toEqual({ x: 10, y: 360, width: 100, height: 20 });
    expect(page.lines[0].words[0]).toEqual({ text: "Hello", box: { x: 10, y: 360, width: 40, height: 20 }, confidence: 0.95 });
  });
  it("drops words whose text is only whitespace", () => {
    const page = tesseractToOcrPage([{ text: " ", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [{ text: " ", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, confidence: 0 }] }], 50, 1, 100);
    expect(page.lines).toEqual([]);
  });
});

describe("linesToOcrPage", () => {
  it("stacks lines evenly from the top with a 36pt margin and 14pt cap", () => {
    const page = linesToOcrPage(["first line", "second"], { widthPt: 300, heightPt: 400 }, 7);
    expect(page.engine).toBe("claude");
    expect(page.lines).toHaveLength(2);
    expect(page.lines[0].box).toEqual({ x: 36, y: 400 - 36 - 14, width: 228, height: 14 });
    expect(page.lines[1].box).toEqual({ x: 36, y: 400 - 36 - 28, width: 228, height: 14 });
    expect(page.lines[0].words.map((w) => w.text)).toEqual(["first", "line"]);
    expect(page.lines[0].words[0].confidence).toBe(0.9);
    const widths = page.lines[0].words.map((w) => w.box.width);
    expect(widths[0] + widths[1]).toBeCloseTo(228);
    expect(widths[0] / widths[1]).toBeCloseTo(5 / 4);
  });
  it("shrinks the line height when there are many lines", () => {
    const page = linesToOcrPage(Array.from({ length: 100 }, (_, i) => `l${i}`), { widthPt: 300, heightPt: 400 });
    expect(page.lines[0].box.height).toBeCloseTo((400 - 72) / 100);
    expect(page.lines[99].box.y).toBeGreaterThanOrEqual(36 - 1e-9);
  });
  it("skips blank lines", () => {
    expect(linesToOcrPage(["a", "", "  ", "b"], { widthPt: 300, heightPt: 400 }).lines.map((l) => l.text)).toEqual(["a", "b"]);
  });
});

describe("ocrPageToItems / ocrPageText / isEmptyOcr", () => {
  const page = linesToOcrPage(["alpha beta", "gamma"], { widthPt: 300, heightPt: 400 });
  it("emits one TextItemBox per word with fontSize = line height", () => {
    const items = ocrPageToItems(page);
    expect(items.map((i) => i.str)).toEqual(["alpha", "beta", "gamma"]);
    expect(items[0].fontSize).toBe(14);
    expect(items[0].x).toBe(36);
  });
  it("joins lines with newlines", () => {
    expect(ocrPageText(page)).toBe("alpha beta\ngamma");
  });
  it("is empty with no words or low confidence", () => {
    expect(isEmptyOcr({ engine: "tesseract", lines: [], confidence: 0.9, at: 0 })).toBe(true);
    expect(isEmptyOcr({ ...page, confidence: 0.2 })).toBe(true);
    expect(isEmptyOcr(page)).toBe(false);
  });
});
