import { useDocumentStore } from "../store/document";
import { useOcrStore, pageKey, isTextPage } from "../store/ocr";
import { ocrStore } from "../ocr/store";
import type { OcrPage } from "../ocr/types";
import { buildDocument } from "./pageOps";
import { rasterizeWithPdfJs } from "../edit/flatten";
import { extractPageText } from "./text";
import type { PageEntry } from "./types";

/** The one path that turns the open document (or some of its pages) into PDF bytes; Download, Extract and Print all use it. */
export async function buildOutputBytes(entries: PageEntry[]): Promise<Uint8Array> {
  const s = useDocumentStore.getState();
  const ids = new Set(entries.map((p) => p.id));
  const ocrPages = new Map<string, OcrPage>();
  let ocrFailed = false;
  const ocrState = useOcrStore.getState().pages;
  for (const p of entries) {
    const src = s.sources.get(p.sourceId);
    if (!src?.hash || ocrState[pageKey(p.sourceId, p.sourcePageIndex)]?.state !== "done" || isTextPage(pageKey(p.sourceId, p.sourcePageIndex))) continue; // typed pages keep their real text: no invisible OCR layer
    try {
      const page = await ocrStore.get(src.hash, p.sourcePageIndex);
      if (page) ocrPages.set(p.id, page);
    } catch {
      if (!ocrFailed) s.setError("Saved without searchable text layer.");
      ocrFailed = true;
    }
  }
  return buildDocument(s.sources, entries, s.edits.filter((e) => ids.has(e.pageEntryId)), s.annotations.filter((a) => ids.has(a.pageEntryId)), s.formValues, (msg) => s.setError(msg), ocrPages, { rasterize: rasterizeWithPdfJs, editedText: async (src, p) => (await extractPageText(src, p)).items });
}
