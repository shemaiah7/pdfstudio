import { describe, it, expect } from "vitest";
import { matchFont } from "./fontMatch";
import { fontInfoFor } from "./fontInfo";

describe("matchFont", () => {
  it.each([
    [{ name: "ABCDEF+Arial-BoldMT" }, "helvetica-bold"],
    [{ name: "TimesNewRomanPS-ItalicMT" }, "times-italic"],
    [{ name: "Georgia-BoldItalic" }, "times-bolditalic"],
    [{ name: "CourierNewPSMT" }, "courier"],
    [{ name: "Consolas" , monospace: true, bold: true }, "courier-bold"],
    [{ name: "OpenSans-SemiBold" }, "helvetica-bold"],
    [{ name: "Calibri", serif: true }, "times"],
    [{ cssFamily: "serif", cssWeight: 700, cssStyle: "italic" }, "times-bolditalic"],
    [{ cssFamily: "sans-serif", cssWeight: 400 }, "helvetica"],
    [{ name: "LiberationSans-Oblique" }, "helvetica-oblique"],
    [{ name: "Garamond-Black" }, "times-bold"],
    [{}, "helvetica"],
  ])("matches %j → %s", (info, expected) => { expect(matchFont(info)).toBe(expected); });
  it("maps OCR items to helvetica regardless of flags", () => {
    expect(matchFont({ name: "ocr", serif: true, bold: true })).toBe("helvetica");
  });
});

describe("fontInfoFor", () => {
  it("reads flags from a loaded pdf.js font object", () => {
    const page = { commonObjs: { has: () => true, get: () => ({ name: "Foo-Bold", isSerifFont: true, isMonospace: false, bold: true, italic: false, black: false }) } };
    expect(fontInfoFor(page, "g_d0_f1", {})).toEqual({ name: "Foo-Bold", serif: true, monospace: false, bold: true, italic: false });
  });
  it("falls back to the text-layer style family when the font is not loaded", () => {
    const page = { commonObjs: { has: () => false, get: () => { throw new Error("not loaded"); } } };
    expect(fontInfoFor(page, "g_d0_f1", { g_d0_f1: { fontFamily: "monospace" } })).toEqual({ cssFamily: "monospace" });
  });
  it("returns the ocr name for OCR items", () => {
    expect(fontInfoFor({ commonObjs: { has: () => false, get: () => null } }, "ocr", {})).toEqual({ name: "ocr" });
  });
});
