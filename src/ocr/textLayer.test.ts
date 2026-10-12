// src/ocr/textLayer.test.ts
import { describe, it, expect } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from "pdf-lib";
import { openPdf } from "../test/pdfjs";
import { addInvisibleText, withoutCoveredWords } from "./textLayer";
import { linesToOcrPage } from "./layout";
import { buildDocument } from "../pdf/pageOps";
import { loadFixture } from "../test/loadFixture";
import type { Edit, SourceFile } from "../pdf/types";
import type { OcrPage } from "./types";

async function textItems(bytes: Uint8Array) {
  const pdf = await openPdf(bytes);
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

describe("withoutCoveredWords", () => {
  const w = (text: string, x: number) => ({ text, box: { x, y: 10, width: 20, height: 10 }, confidence: 1 });
  const page: OcrPage = { engine: "tesseract", confidence: 1, at: 1, lines: [
    { text: "a b c", box: { x: 0, y: 10, width: 100, height: 10 }, words: [w("a", 0), w("b", 30), w("c", 60)] },
    { text: "d", box: { x: 0, y: 50, width: 20, height: 10 }, words: [{ ...w("d", 0), box: { x: 0, y: 50, width: 20, height: 10 } }] },
  ] };
  it("drops fully covered, partially covered; keeps outside and edge-touching words", () => {
    const out = withoutCoveredWords(page, [{ x: 25, y: 0, width: 40, height: 30 }]); // b fully inside, a touches edge at 20<25 no, c partial
    expect(out.lines[0].words.map((x) => x.text)).toEqual(["a"]);
    expect(withoutCoveredWords(page, [{ x: 20, y: 10, width: 10, height: 10 }]).lines[0].words.length).toBe(3); // touching edges only
  });
  it("removes lines left with no words", () => {
    const out = withoutCoveredWords(page, [{ x: 0, y: 45, width: 30, height: 30 }]);
    expect(out.lines.map((l) => l.text)).toEqual(["a b c"]);
  });
  it("end to end: a word under an edit is absent from the output text", async () => {
    const sources = new Map<string, SourceFile>([["a", { id: "a", name: "three.pdf", bytes: loadFixture("three"), pageCount: 3 }]]);
    const entry = { id: "p1", sourceId: "a", sourcePageIndex: 0, rotation: 0 as const };
    const ocr: OcrPage = { engine: "tesseract", confidence: 1, at: 1, lines: [{ text: "secret keep", box: { x: 20, y: 200, width: 200, height: 20 }, words: [
      { text: "secretword", box: { x: 20, y: 200, width: 80, height: 20 }, confidence: 1 }, { text: "keepword", box: { x: 120, y: 200, width: 80, height: 20 }, confidence: 1 }] }] };
    const edit: Edit = { id: "e", pageEntryId: "p1", boxes: [{ x: 10, y: 195, width: 100, height: 30 }], text: "", fontSize: 12, font: "helvetica", color: [0, 0, 0] };
    const out = await buildDocument(sources, [entry], [edit], [], new Map(), undefined, new Map([["p1", ocr]]));
    const strs = (await textItems(out)).map((i) => i.str).join(" ");
    expect(strs).not.toContain("secretword");
    expect(strs).toContain("keepword");
  });
  it("writes no text layer for an edited Deep OCR page, warns once, and keeps unedited Deep OCR pages", async () => {
    const sources = new Map<string, SourceFile>([["a", { id: "a", name: "three.pdf", bytes: loadFixture("three"), pageCount: 3 }]]);
    const entries = [0, 1].map((i) => ({ id: `p${i}`, sourceId: "a", sourcePageIndex: i, rotation: 0 as const }));
    const deep: OcrPage = { engine: "claude", confidence: 1, at: 1, lines: [{ text: "secret keep", box: { x: 20, y: 200, width: 200, height: 20 }, words: [
      { text: "secretword", box: { x: 20, y: 200, width: 80, height: 20 }, confidence: 1 }, { text: "keepword", box: { x: 120, y: 200, width: 80, height: 20 }, confidence: 1 }] }] };
    const edit: Edit = { id: "e", pageEntryId: "p0", boxes: [{ x: 10, y: 195, width: 100, height: 30 }], text: "", fontSize: 12, font: "helvetica", color: [0, 0, 0] };
    const warnings: string[] = [];
    const out = await buildDocument(sources, entries, [edit], [], new Map(), (m) => warnings.push(m), new Map([["p0", deep], ["p1", deep]]));
    const strs = (await textItems(out)).map((i) => i.str).join(" ");
    expect(strs).not.toContain("secretword");
    expect(strs).not.toContain("keepword");
    expect(warnings).toEqual(["Searchable text left out of edited Deep OCR pages."]);
    const pdf = await openPdf(out);
    const second = (await (await pdf.getPage(2)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(second).toContain("keepword");
  });
});
