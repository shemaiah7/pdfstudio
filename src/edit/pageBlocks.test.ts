import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { useDocumentStore } from "../store/document";
import { useOcrStore, pageKey } from "../store/ocr";
import { loadFixture } from "../test/loadFixture";
import { clearTextCache, invalidatePageText } from "../pdf/text";
import { ocrStore } from "../ocr/store";
import { linesToOcrPage } from "../ocr/layout";
import { pageBlocks, clearPageBlocks } from "./pageBlocks";
import { blockAt } from "./blocks";

const open = async (name: "offset" | "scan" | "three") => {
  await useDocumentStore.getState().openFiles([{ name: `${name}.pdf`, bytes: loadFixture(name) }]);
  return [...useDocumentStore.getState().sources.values()][0];
};

describe("pageBlocks", () => {
  beforeAll(async () => {
    (await import("pdfjs-dist")).GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
  });
  beforeEach(async () => { clearTextCache(); clearPageBlocks(); await ocrStore.clear(); useDocumentStore.getState().reset(); useOcrStore.setState({ pages: {} }); });

  it("finds the block at the visible word's crop-relative point on an offset page", async () => {
    const src = await open("offset"); // crop box origin (50, 100); the word sits at user-space (70, 460)
    const { blocks } = await pageBlocks(src, 0);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(blockAt(blocks, 20 + 3, 360 + 3)).toBe(b);
    expect(blockAt(blocks, 70 + 3, 460 + 3, 0)).toBeUndefined();
  });
  it("does not cache an empty block list", async () => {
    const src = await open("scan");
    expect((await pageBlocks(src, 0)).blocks).toEqual([]);
    await ocrStore.put(src.hash!, 0, linesToOcrPage(["Patient Jane"], { widthPt: 300, heightPt: 400 }));
    invalidatePageText(src.id, 0); // same OCR state ("none"): only a non-cached empty result can see the new text
    expect((await pageBlocks(src, 0)).blocks).toHaveLength(1);
  });
  it("replaces a stale entry after the OCR state changes", async () => {
    const src = await open("scan");
    await ocrStore.put(src.hash!, 0, linesToOcrPage(["Patient Jane"], { widthPt: 300, heightPt: 400 }));
    useOcrStore.setState({ pages: { [pageKey(src.id, 0)]: { state: "done", engine: "tesseract" } } });
    const first = await pageBlocks(src, 0);
    expect(first.blocks[0].text).toContain("Patient");
    expect(await pageBlocks(src, 0)).toBe(first); // cached while nothing changed
    await ocrStore.put(src.hash!, 0, linesToOcrPage(["Dose changed"], { widthPt: 300, heightPt: 400 }));
    invalidatePageText(src.id, 0);
    useOcrStore.setState({ pages: { [pageKey(src.id, 0)]: { state: "done", engine: "claude" } } });
    expect((await pageBlocks(src, 0)).blocks[0].text).toContain("Dose");
  });
  it("replaces the entry when the page's edits change", async () => {
    const src = await open("three");
    const first = await pageBlocks(src, 0);
    const st = useDocumentStore.getState();
    const it0 = first.blocks[0];
    st.addEdit({ pageEntryId: st.pages[0].id, boxes: [it0.box], region: it0.box, text: "nine:9", fontSize: it0.fontSize, font: "helvetica", color: [0, 0, 0] });
    await new Promise((r) => setTimeout(r, 2)); // the stamp is a millisecond clock
    expect((await pageBlocks(src, 0)).blocks[0].text).toBe("nine:9");
  });
});
