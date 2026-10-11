import { describe, it, expect } from "vitest";
import { StandardFonts } from "pdf-lib";
import { EDIT_FONTS, normalizeFont, STANDARD_FONTS, FONT_CSS, fontFamily } from "./fonts";

describe("fonts", () => {
  it("lists the 12 standard faces and maps each to pdf-lib", () => {
    expect(EDIT_FONTS).toHaveLength(12);
    expect(STANDARD_FONTS["courier-boldoblique"]).toBe(StandardFonts.CourierBoldOblique);
    expect(STANDARD_FONTS["times-bolditalic"]).toBe(StandardFonts.TimesRomanBoldItalic);
    expect(STANDARD_FONTS["helvetica"]).toBe(StandardFonts.Helvetica);
  });
  it("normalises legacy names and unknowns", () => {
    expect(normalizeFont("sans")).toBe("helvetica");
    expect(normalizeFont("sans-bold")).toBe("helvetica-bold");
    expect(normalizeFont("serif")).toBe("times");
    expect(normalizeFont("times-italic")).toBe("times-italic");
    expect(normalizeFont("nope")).toBe("helvetica");
  });
  it("builds CSS with weight and style", () => {
    expect(FONT_CSS["helvetica-boldoblique"]).toBe("italic 700 1px Helvetica, Arial, sans-serif");
    expect(FONT_CSS["courier"]).toBe("400 1px 'Courier New', Courier, monospace");
    expect(fontFamily("times-bold")).toBe("times");
  });
});
