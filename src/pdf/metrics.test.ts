import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { measureFor } from "./metrics";

describe("measureFor", () => {
  it("matches pdf-lib's Helvetica width", async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const measure = await measureFor("sans");
    expect(measure("Hello", 10)).toBe(helv.widthOfTextAtSize("Hello", 10));
  });
  it("does not throw on non-WinAnsi text", async () => {
    const measure = await measureFor("serif");
    expect(measure("Hi 中", 10)).toBeGreaterThan(0);
  });
});
