import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { useDocumentStore } from "../store/document";
import { loadFixture } from "../test/loadFixture";
import { extractPageText, clearTextCache, invalidatePageText, setOcrLookup, editsStamp } from "./text";
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
