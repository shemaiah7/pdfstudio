import { describe, it, expect } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream } from "pdf-lib";
import { openPdf } from "../test/pdfjs";
import { cappedScale, flattenPage, itemsToOcrPage, MAX_RASTER_PIXELS, paintCovers } from "./flatten";
import type { TextItemBox } from "../pdf/text";

import { PNG_1X1 } from "../test/png";
const item = (str: string, x: number, y: number, width: number, fontSize = 10): TextItemBox => ({ str, x, y, width, height: fontSize, fontSize, fontName: "g_d0_f1" });

describe("itemsToOcrPage", () => {
  it("keeps OCR item boxes as they are (y is the box bottom, not a baseline)", () => {
    const page = itemsToOcrPage([{ str: "Patient", x: 20, y: 100, width: 40, height: 10, fontSize: 10, fontName: "ocr" }]);
    expect(page.lines[0].words[0].box).toEqual({ x: 20, y: 100, width: 40, height: 10 });
    expect(page.lines[0].box).toEqual({ x: 20, y: 100, width: 40, height: 10 });
  });
  it("groups items on a baseline into one line with padded word boxes", () => {
    const page = itemsToOcrPage([item("world", 60, 100, 30), item("hello", 20, 100, 30), item("next", 20, 80, 24)]);
    expect(page.lines.map((l) => l.text)).toEqual(["hello world", "next"]);
    expect(page.lines[0].words.map((w) => w.text)).toEqual(["hello", "world"]);
    expect(page.lines[0].words[0].box).toEqual({ x: 20, y: 97.5, width: 30, height: 12 });
    expect(page.lines[0].box).toEqual({ x: 20, y: 97.5, width: 70, height: 12 });
  });
});

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await openPdf(bytes);
  const content = await (await pdf.getPage(1)).getTextContent();
  return content.items.map((i) => ("str" in i ? i.str : "")).filter(Boolean);
}

describe("flattenPage", () => {
  it("drops the original text object, draws the raster, and leaves only the invisible layer", async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 200]).drawText("original", { x: 20, y: 100, size: 12, font: await src.embedFont(StandardFonts.Helvetica) });
    const srcBytes = await src.save();
    expect(await textOf(srcBytes)).toContain("original");
    // Like buildDocument: the page is a loaded/copied one, not one this PDFPage object already drew on.
    const doc = await PDFDocument.load(srcBytes);
    const page = doc.getPages()[0];
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let drawn = false;
    await flattenPage(doc, page, { png: PNG_1X1, widthPt: 200, heightPt: 200, items: [item("kept", 20, 50, 30)], cropOrigin: { x: 0, y: 0 } }, font, () => { drawn = true; page.drawText("edit", { x: 5, y: 5, size: 8, font }); });
    expect(drawn).toBe(true);
    const bytes = await doc.save();
    const words = await textOf(bytes);
    expect(words).toContain("kept");
    expect(words).toContain("edit");
    expect(words).not.toContain("original");
    const xobjs = (await PDFDocument.load(bytes)).getPages()[0].node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    expect(xobjs.keys()).toHaveLength(1);
  });
});

describe("flattenPage content removal and rollback", () => {
  const setup = async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 200]).drawText("original", { x: 20, y: 100, size: 12, font: await src.embedFont(StandardFonts.Helvetica) });
    const doc = await PDFDocument.load(await src.save());
    return { doc, page: doc.getPages()[0], font: await doc.embedFont(StandardFonts.Helvetica) };
  };
  const input = { png: PNG_1X1, widthPt: 200, heightPt: 200, items: [item("kept", 20, 50, 30)], cropOrigin: { x: 0, y: 0 } };
  const rawStreams = async (bytes: Uint8Array) => {
    const d = await PDFDocument.load(bytes);
    let all = "";
    for (const [, o] of d.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) all += new TextDecoder("latin1").decode(decodePDFRawStream(o).decode()) + "\n";
    return all;
  };
  const hex = (t: string) => [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
  it("deletes the original content stream and resources from the document", async () => {
    const { doc, page, font } = await setup();
    const old = page.node.get(PDFName.of("Contents"));
    await flattenPage(doc, page, input, font);
    expect((await rawStreams(await doc.save())).toUpperCase()).not.toContain(hex("original"));
    const refs = old instanceof PDFArray ? old.asArray() : [old];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) if (r instanceof PDFRef && ![doc.context.getPushGraphicsStateContentStream(), doc.context.getPopGraphicsStateContentStream()].includes(r)) expect(doc.context.lookup(r)).toBeUndefined();
    expect(page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict).keys().length).toBe(1); // only the invisible layer's font
  });
  it("restores the original /Contents and /Resources when drawing fails after the clear", async () => {
    const { doc, page, font } = await setup();
    const contents = page.node.get(PDFName.of("Contents")), resources = page.node.get(PDFName.of("Resources"));
    await expect(flattenPage(doc, page, input, font, () => { page.drawText("edit", { x: 5, y: 5, size: 8, font }); throw new Error("late"); })).rejects.toThrow("late");
    expect(page.node.get(PDFName.of("Contents"))).toBe(contents);
    expect(page.node.get(PDFName.of("Resources"))).toBe(resources);
    page.drawText("fallback", { x: 5, y: 150, size: 8, font }); // later drawing must land in the restored page
    const words = await textOf(await doc.save());
    expect(words).toContain("original");
    expect(words).toContain("fallback");
    expect(words).not.toContain("edit");
  });
});

describe("paintCovers", () => {
  it("fills each cover in its colour at crop-relative pixel coordinates (y flipped)", () => {
    const calls: [string, number, number, number, number][] = [];
    const ctx = { fillStyle: "" as string, fillRect(x: number, y: number, w: number, h: number) { calls.push([this.fillStyle, x, y, w, h]); } };
    paintCovers(ctx, [{ box: { x: 10, y: 100, width: 50, height: 12 }, color: [1, 0.5, 0] }], 2, 400);
    expect(calls).toEqual([["rgb(255,128,0)", 20, 576, 100, 24]]); // top = (400 - 100 - 12) * 2
  });
});

describe("cappedScale", () => {
  it("keeps the requested DPI for normal pages", () => { expect(cappedScale(612, 792, 200)).toBeCloseTo(200 / 72); });
  it("reduces the DPI so a 36x48 in page stays within the raster pixel cap", () => {
    const w = 36 * 72, h = 48 * 72, s = cappedScale(w, h, 200);
    expect(s).toBeLessThan(200 / 72);
    expect(Math.ceil(w * s) * Math.ceil(h * s)).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
  });
});
