import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { useDocumentStore } from "../store/document";
import { loadFixture } from "../test/loadFixture";
import { extractPageText, clearTextCache, invalidatePageText, setOcrLookup, editsStamp, coveredBy } from "./text";
import { layoutBlock } from "../edit/layout";
import { ocrStore } from "../ocr/store";
import { linesToOcrPage } from "../ocr/layout";
import { sha256 } from "./hash";

describe("extractPageText OCR merge", () => {
  // render.ts derives workerSrc from import.meta.url, which does not resolve under Vitest/node; point at the real file.
  beforeAll(async () => {
    (await import("pdfjs-dist")).GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
  });
  beforeEach(async () => { clearTextCache(); await ocrStore.clear(); useDocumentStore.getState().reset(); });
  it("returns pdf.js text when the page has text", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    const src = [...useDocumentStore.getState().sources.values()][0];
    expect((await extractPageText(src, 0)).text).toBe("three:0");
  });
  it("returns OCR words when pdf.js has none, and sees new OCR after invalidation", async () => {
    await useDocumentStore.getState().openFiles([{ name: "scan.pdf", bytes: loadFixture("scan") }]);
    const src = [...useDocumentStore.getState().sources.values()][0];
    expect(src.hash).toBe(await sha256(src.bytes));
    expect((await extractPageText(src, 0)).text).toBe("");
    await ocrStore.put(src.hash!, 0, linesToOcrPage(["Patient Jane"], { widthPt: 300, heightPt: 400 }));
    expect((await extractPageText(src, 0)).text).toBe("");           // cached
    invalidatePageText(src.id, 0);
    const t = await extractPageText(src, 0);
    expect(t.text).toBe("Patient Jane");
    expect(t.ocr).toBe(true);
    expect(t.items.map((i) => i.str)).toEqual(["Patient", "Jane"]);
  });
  it("treats whitespace-only pdf.js items as no text", async () => {
    await useDocumentStore.getState().openFiles([{ name: "scan.pdf", bytes: loadFixture("scan") }]);
    const src = [...useDocumentStore.getState().sources.values()][0];
    await ocrStore.put(src.hash!, 0, linesToOcrPage(["x y"], { widthPt: 300, heightPt: 400 }));
    const { linesFromItems } = await import("./text");
    expect(linesFromItems([{ str: " ", transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 }]).trim()).toBe("");
    expect((await extractPageText(src, 0)).text).toBe("x y");
  });
  it("a text page with a Deep OCR result returns the transcription but keeps the pdf.js items", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    const src = [...useDocumentStore.getState().sources.values()][0];
    const before = await extractPageText(src, 0);
    expect(before.text).toBe("three:0");
    await ocrStore.put(src.hash!, 0, { ...linesToOcrPage(["Typed form", "Handwritten: hold warfarin"], { widthPt: 300, heightPt: 400 }), engine: "claude" });
    invalidatePageText(src.id, 0);
    const t = await extractPageText(src, 0);
    expect(t.text).toBe("Typed form\nHandwritten: hold warfarin");
    expect(t.ocr).toBeUndefined();
    expect(t.items).toEqual(before.items);
  });
  it("ignores a Tesseract result on a page that has pdf.js text", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    const src = [...useDocumentStore.getState().sources.values()][0];
    await ocrStore.put(src.hash!, 0, { ...linesToOcrPage(["tess words"], { widthPt: 300, heightPt: 400 }), engine: "tesseract" });
    expect((await extractPageText(src, 0)).text).toBe("three:0");
  });
  it("returns empty text when the OCR lookup throws", async () => {
    await useDocumentStore.getState().openFiles([{ name: "scan.pdf", bytes: loadFixture("scan") }]);
    const src = [...useDocumentStore.getState().sources.values()][0];
    setOcrLookup(async () => { throw new Error("idb broke"); });
    try { expect(await extractPageText(src, 0)).toEqual({ text: "", items: [] }); }
    finally { setOcrLookup(); }
  });
});

describe("edits overlay in extractPageText", () => {
  it("replaces covered items with the edit's lines and bumps the stamp", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    const st = useDocumentStore.getState();
    const src = [...st.sources.values()][0];
    const before = await extractPageText(src, 0);
    expect(before.text).toBe("three:0");
    const item = before.items[0];
    const box = { x: item.x, y: item.y - item.fontSize * 0.25, width: item.width + 2, height: item.fontSize * 1.2 };
    const lay = layoutBlock("nine:9", box, item.fontSize, item.fontSize * 1.2, (t, s) => t.length * s * 0.5);
    const t0 = Date.now();
    st.addEdit({ pageEntryId: st.pages[0].id, boxes: lay.boxes, text: "nine:9", fontSize: item.fontSize, font: "helvetica", color: [0, 0, 0], background: [1, 1, 1], lineHeight: item.fontSize * 1.2, source: "native", blockKey: "k" });
    const after = await extractPageText(src, 0);
    expect(after.text).toBe("nine:9");
    expect(after.items.map((i) => i.str)).toEqual(["nine:9"]);
    expect(editsStamp(src.id)).toBeGreaterThanOrEqual(t0);
    useDocumentStore.getState().undo();
    expect((await extractPageText(src, 0)).text).toBe("three:0");
  });
});

describe("crop-relative coordinates and edit overlay rules", () => {
  beforeEach(async () => { clearTextCache(); await ocrStore.clear(); useDocumentStore.getState().reset(); });
  const open = async (name: "offset" | "scan" | "three") => {
    await useDocumentStore.getState().openFiles([{ name: `${name}.pdf`, bytes: loadFixture(name) }]);
    return [...useDocumentStore.getState().sources.values()][0];
  };
  it("reports native items relative to the crop box origin", async () => {
    const src = await open("offset"); // crop box origin (50, 100)
    const { items, text } = await extractPageText(src, 0);
    expect(items).toHaveLength(1);
    expect(items[0].x).toBeCloseTo(20, 0);
    expect(items[0].y).toBeCloseTo(360, -1);
    expect(items[0].y).toBeLessThan(400);
    expect(text).toBe(items[0].str); // text itself is unchanged by the shift
  });
  it("finds the block under a crop-relative click on an offset page", async () => {
    const { blocksFrom, linesFrom, blockAt } = await import("../edit/blocks");
    const src = await open("offset");
    const { items } = await extractPageText(src, 0);
    const blocks = blocksFrom(linesFrom(items));
    const it0 = items[0];
    expect(blockAt(blocks, it0.x + 3, it0.y + it0.fontSize * 0.3)).toBeDefined();
    expect(blockAt(blocks, it0.x + 3 + 50, it0.y + it0.fontSize * 0.3 + 100, 0)).toBeUndefined(); // the old user-space point misses
  });
  it("drops an item spanning the whole line when a cover touches only its middle", async () => {
    const src = await open("three");
    const st = useDocumentStore.getState();
    const [it0] = (await extractPageText(src, 0)).items;
    const mid = { x: it0.x + it0.width * 0.4, y: it0.y - it0.fontSize * 0.25, width: it0.width * 0.1, height: it0.fontSize };
    st.addEdit({ pageEntryId: st.pages[0].id, boxes: [mid], text: "", fontSize: it0.fontSize, font: "helvetica", color: [0, 0, 0] });
    const after = await extractPageText(src, 0);
    expect(after.items.some((i) => i.str === it0.str)).toBe(false);
  });
  it("keeps the line above an edit (items abutting the cover are not touched)", async () => {
    const src = await open("three");
    const st = useDocumentStore.getState();
    const [it0] = (await extractPageText(src, 0)).items;
    const top = it0.y + it0.fontSize * 0.8;
    st.addEdit({ pageEntryId: st.pages[0].id, boxes: [{ x: 0, y: top, width: 600, height: 30 }], text: "", fontSize: 10, font: "helvetica", color: [0, 0, 0] });
    expect((await extractPageText(src, 0)).items.map((i) => i.str)).toContain(it0.str);
  });
  it("applies an edit to OCR items: edited text replaces the recognized words", async () => {
    const src = await open("scan");
    const mk = (text: string, y: number) => ({ text, box: { x: 20, y, width: 200, height: 10 }, words: text.split(" ").map((t, k) => ({ text: t, confidence: 0.9, box: { x: 20 + k * 60, y, width: 55, height: 10 } })) });
    const page = { ...linesToOcrPage(["x"], { widthPt: 300, heightPt: 400 }), lines: [mk("Patient hypertension noted", 300), mk("second line", 270)] };
    await ocrStore.put(src.hash!, 0, page);
    invalidatePageText(src.id, 0);
    const before = await extractPageText(src, 0);
    expect(before.ocr).toBe(true);
    const line1 = page.lines[0].box;
    const st = useDocumentStore.getState();
    const lay = layoutBlock("Patient hypotension noted", line1, line1.height, line1.height, (t, s) => t.length * s * 0.5);
    st.addEdit({ pageEntryId: st.pages[0].id, boxes: lay.boxes, region: line1, text: "Patient hypotension noted", fontSize: line1.height, font: "helvetica", color: [0, 0, 0], lineHeight: line1.height, source: "ocr" });
    const after = await extractPageText(src, 0);
    expect(after.text).toContain("Patient hypotension noted");
    expect(after.text).not.toContain("hypertension");
    expect(after.text).toContain("second line");
    expect((await ocrStore.get(src.hash!, 0))!.lines[0].text).toBe("Patient hypertension noted"); // the persistent store is untouched
  });
});

describe("coveredBy", () => {
  const cover = { x: 0, y: 100, width: 200, height: 14 };
  const native = (y: number, extra: object = {}) => ({ str: "t", x: 10, y, width: 100, height: 12, fontSize: 12, fontName: "g_d0_f1", ...extra });
  it("drops a full-line item with a cover over its middle", () => { expect(coveredBy(native(102), [cover])).toBe(true); });
  it("keeps a heading above a moved edit at 1.2 leading", () => { expect(coveredBy(native(cover.y + cover.height + 0.95 * 12), [cover])).toBe(false); });
  it("keeps an OCR line whose box only grazes the cover's edge", () => {
    const h = 10;
    expect(coveredBy({ str: "t", x: 10, y: cover.y - 0.81 * h, width: 100, height: h, fontSize: h, fontName: "ocr" }, [cover])).toBe(false); // neighbour above
    expect(coveredBy({ str: "t", x: 10, y: cover.y + cover.height - 0.19 * h, width: 100, height: h, fontSize: h, fontName: "ocr" }, [cover])).toBe(false); // neighbour below
  });
  it("drops an item fully inside the cover", () => { expect(coveredBy(native(102, { width: 20 }), [cover])).toBe(true); });
  it("keeps an item with no horizontal overlap", () => { expect(coveredBy(native(102, { x: 300 }), [cover])).toBe(false); });
});
