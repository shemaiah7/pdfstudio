// src/ocr/textLayer.test.ts
import { describe, it, expect } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { addInvisibleText } from "./textLayer";
import { linesToOcrPage } from "./layout";
import type { OcrPage } from "./types";

async function textItems(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  const page = await pdf.getPage(1);
  const c = await page.getTextContent();
  return c.items.filter((i): i is typeof i & { str: string; transform: number[] } => "str" in i).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
}

// pdf-lib Flate-compresses content streams, so inflate them before looking for operators.
async function contentText(bytes: Uint8Array) {
  const reloaded = await PDFDocument.load(bytes);
  const contents = reloaded.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => reloaded.context.lookup(r)) : [contents];
  return streams.map((st) => new TextDecoder("latin1").decode(decodePDFRawStream(st as PDFRawStream).decode())).join("\n");
}

describe("addInvisibleText", () => {
  it("writes each word as invisible text at its box", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    const ocr: OcrPage = { engine: "tesseract", confidence: 0.9, at: 1, lines: [{ text: "Hello wörld", box: { x: 50, y: 300, width: 120, height: 20 }, words: [
      { text: "Hello", box: { x: 50, y: 300, width: 50, height: 20 }, confidence: 0.9 }, { text: "wörld", box: { x: 110, y: 300, width: 60, height: 20 }, confidence: 0.9 }] }] };
    addInvisibleText(page, font, ocr, { x: 0, y: 0 });
    const items = (await textItems(await doc.save())).filter((i) => i.str.trim());
    expect(items.map((i) => i.str)).toEqual(["Hello", "wörld"]);
    expect(items[0].x).toBeCloseTo(50, 0); expect(items[0].y).toBeCloseTo(300 + 20 * 0.2, 0);
    expect(items[1].x).toBeCloseTo(110, 0);
    expect(await contentText(await doc.save())).toMatch(/3 Tr/);
  });
  it("offsets by the crop origin and survives a rotated page", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    page.setCropBox(50, 100, 250, 300);
    page.setRotation(degrees(90));
    addInvisibleText(page, font, linesToOcrPage(["rotated"], { widthPt: 250, heightPt: 300 }), { x: 50, y: 100 });
    const items = (await textItems(await doc.save())).filter((i) => i.str.trim());
    expect(items[0].str).toBe("rotated");
  });
  it("replaces characters outside WinAnsi and never throws", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    addInvisibleText(page, font, linesToOcrPage(["温度 ok"], { widthPt: 300, heightPt: 400 }), { x: 0, y: 0 });
    const items = (await textItems(await doc.save())).filter((i) => i.str.trim());
    expect(items.map((i) => i.str)).toEqual(["??", "ok"]);
  });
});
