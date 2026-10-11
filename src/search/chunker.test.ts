import { describe, it, expect } from "vitest";
import { chunkPage } from "./chunker";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("chunkPage", () => {
  it("returns nothing for pages with fewer than 3 words", () => {
    expect(chunkPage(0, "")).toEqual([]);
    expect(chunkPage(0, "  one two  ")).toEqual([]);
  });
  it("makes one chunk for a short page", () => {
    const c = chunkPage(2, "alpha beta gamma delta");
    expect(c).toEqual([{ page: 2, start: 0, end: 22, text: "alpha beta gamma delta" }]);
  });
  it("windows 200 words stepping 160 and ends at the last word", () => {
    const text = words(500);
    const c = chunkPage(0, text);
    expect(c.map((x) => x.text.split(" ").length)).toEqual([200, 200, 180]);
    expect(c[1].text.startsWith("w160 ")).toBe(true);
    expect(c[2].end).toBe(text.length);
  });
  it("offsets reconstruct the text and never cross pages", () => {
    const text = "line one\nline two   has  gaps\nline three";
    for (const c of chunkPage(4, text)) {
      expect(text.slice(c.start, c.end)).toBe(c.text);
      expect(c.page).toBe(4);
    }
  });
  it("handles a 10000-word page quickly", () => {
    const t0 = performance.now();
    const c = chunkPage(0, words(10_000));
    expect(c.length).toBe(Math.ceil((10_000 - 200) / 160) + 1);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
