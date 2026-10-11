import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { measureFor } from "./metrics";

describe("measureFor", () => {
  it("matches pdf-lib's Helvetica width", async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const measure = await measureFor("helvetica");
    expect(measure("Hello", 10)).toBe(helv.widthOfTextAtSize("Hello", 10));
  });
  it("measures WinAnsi punctuation as the real glyph", async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    expect((await measureFor("helvetica"))("a\u2014b", 12)).toBe(helv.widthOfTextAtSize("a\u2014b", 12));
  });
  it("does not throw on non-WinAnsi text", async () => {
    const measure = await measureFor("times");
    expect(measure("Hi 中", 10)).toBeGreaterThan(0);
  });
});
