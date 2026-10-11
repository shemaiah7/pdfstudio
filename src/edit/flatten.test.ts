import { describe, it, expect } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { flattenPage, itemsToOcrPage } from "./flatten";
import type { TextItemBox } from "../pdf/text";

import { PNG_1X1 } from "../test/png";
const item = (str: string, x: number, y: number, width: number, fontSize = 10): TextItemBox => ({ str, x, y, width, height: fontSize, fontSize, fontName: "g_d0_f1" });

describe("itemsToOcrPage", () => {
  it("groups items on a baseline into one line with padded word boxes", () => {
    const page = itemsToOcrPage([item("world", 60, 100, 30), item("hello", 20, 100, 30), item("next", 20, 80, 24)]);
    expect(page.lines.map((l) => l.text)).toEqual(["hello world", "next"]);
    expect(page.lines[0].words.map((w) => w.text)).toEqual(["hello", "world"]);
    expect(page.lines[0].words[0].box).toEqual({ x: 20, y: 97.5, width: 30, height: 12 });
    expect(page.lines[0].box).toEqual({ x: 20, y: 97.5, width: 70, height: 12 });
  });
});

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
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
