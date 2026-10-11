// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ocrTextContent, hideCoveredSpans } from "./TextLayer";
import { linesToOcrPage } from "../ocr/layout";

describe("ocrTextContent", () => {
  it("builds pdf.js text items with a transform per word and EOL per line", () => {
    const tc = ocrTextContent(linesToOcrPage(["alpha beta", "gamma"], { widthPt: 300, heightPt: 400 }));
    const items = tc.items as { str: string; transform: number[]; width: number; height: number; hasEOL: boolean; fontName: string }[];
    expect(items.map((i) => i.str)).toEqual(["alpha", " ", "beta", "gamma"]);
    expect(items[0].transform).toEqual([14, 0, 0, 14, 36, 400 - 36 - 14]);
    expect(items[0].hasEOL).toBe(false);
    expect(items[2].hasEOL).toBe(true);
    expect(items[3].hasEOL).toBe(true);
    expect(items[0].fontName).toBe("ocr");
    expect(tc.styles).toHaveProperty("ocr");
  });

  it("offsets transforms by the crop-box origin", () => {
    const page = linesToOcrPage(["alpha beta"], { widthPt: 300, heightPt: 400 });
    const items = ocrTextContent(page, { x: 10, y: 20 }).items as { transform: number[] }[];
    expect(items[0].transform).toEqual([14, 0, 0, 14, 36 + 10, 400 - 36 - 14 + 20]);
    expect(items[1].transform[4]).toBe(page.lines[0].words[0].box.x + page.lines[0].words[0].box.width + 10);
    expect(items[1].transform[5]).toBe(400 - 36 - 14 + 20);
  });
});

it("hides spans that intersect edit boxes", () => {
  const c = document.createElement("div");
  const a = document.createElement("span"); a.getBoundingClientRect = () => ({ left: 10, top: 10, width: 50, height: 10, right: 60, bottom: 20 } as DOMRect); c.appendChild(a);
  const b = document.createElement("span"); b.getBoundingClientRect = () => ({ left: 10, top: 200, width: 50, height: 10, right: 60, bottom: 210 } as DOMRect); c.appendChild(b);
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400 } as DOMRect);
  hideCoveredSpans(c, [{ x: 0, y: 380, width: 100, height: 15 }], 1, 400);
  expect(a.style.visibility).toBe("hidden");
  expect(b.style.visibility).toBe("");
});
