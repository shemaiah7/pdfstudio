import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDocumentStore } from "../store/document";
import * as pdfjs from "pdfjs-dist";
import type { Box, PageEntry, SourceFile } from "../pdf/types";
import { getPage } from "../pdf/render";
import { useOcrStore, pageKey } from "../store/ocr";
import { ocrStore } from "../ocr/store";
import type { OcrPage } from "../ocr/types";

interface Props { source: SourceFile; entry: PageEntry; scale: number }

/** OCR boxes are relative to the crop-box origin; pdf.js TextLayer wants user space, so add the origin back. */
export function ocrTextContent(ocr: OcrPage, origin: { x: number; y: number } = { x: 0, y: 0 }) {
  const items: unknown[] = [];
  for (const line of ocr.lines) {
    line.words.forEach((w, i) => {
      const h = line.box.height;
      const x = w.box.x + origin.x;
      const y = w.box.y + origin.y;
      items.push({ str: w.text, dir: "ltr", transform: [h, 0, 0, h, x, y], width: w.box.width, height: h, fontName: "ocr", hasEOL: i === line.words.length - 1 });
      if (i < line.words.length - 1) items.push({ str: " ", dir: "ltr", transform: [h, 0, 0, h, x + w.box.width, y], width: Math.max(0, line.words[i + 1].box.x - (w.box.x + w.box.width)), height: h, fontName: "ocr", hasEOL: false });
    });
  }
  return { items, styles: { ocr: { fontFamily: "sans-serif", ascent: 0.9, descent: -0.2, vertical: false } } };
}

/** Hide text-layer spans covered by an edit so the original text can't be selected or searched through the cover. */
export function hideCoveredSpans(container: HTMLElement, boxes: Box[], scale: number, heightPt: number) {
  const c = container.getBoundingClientRect();
  const rects = boxes.map((b) => ({ left: b.x * scale, right: (b.x + b.width) * scale, top: (heightPt - b.y - b.height) * scale, bottom: (heightPt - b.y) * scale }));
  for (const span of container.querySelectorAll<HTMLElement>("span")) {
    const r = span.getBoundingClientRect();
    const l = r.left - c.left, t = r.top - c.top, rr = r.right - c.left, bb = r.bottom - c.top;
    const hit = rects.some((b) => l < b.right && rr > b.left && t < b.bottom && bb > b.top);
    span.style.visibility = hit ? "hidden" : "";
  }
}

export default function TextLayer({ source, entry, scale }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pageEdits = useDocumentStore(useShallow((s) => s.edits.filter((e) => e.pageEntryId === entry.id)));
  const heightPtRef = useRef(0);
  const ocrState = useOcrStore((s) => s.pages[pageKey(source.id, entry.sourcePageIndex)]);
  const editsRef = useRef(pageEdits);
  const applyHidden = useCallback(() => {
    const el = ref.current;
    if (el && heightPtRef.current) hideCoveredSpans(el, editsRef.current.flatMap((e) => e.boxes), scale, heightPtRef.current);
  }, [scale]);
  useEffect(() => { editsRef.current = pageEdits; applyHidden(); }, [pageEdits, applyHidden]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    el.replaceChildren();
    (async () => {
      const page = await getPage(source, entry.sourcePageIndex);
      if (cancelled) return;
      const viewport = page.getViewport({ scale, rotation: page.rotate + entry.rotation });
      el.style.setProperty("--scale-factor", String(scale));
      el.style.width = `${Math.floor(viewport.width)}px`;
      el.style.height = `${Math.floor(viewport.height)}px`;
      const textContentSource = await page.getTextContent();
      if (cancelled) return;
      let sourceForLayer: unknown = textContentSource;
      const hasText = textContentSource.items.some((i) => "str" in i && i.str.trim().length > 0);
      if (!hasText && source.hash && ocrState?.state === "done") {
        const ocr = await ocrStore.get(source.hash, entry.sourcePageIndex);
        if (cancelled) return;
        if (ocr) sourceForLayer = ocrTextContent(ocr, { x: page.view[0], y: page.view[1] });
      }
      layer = new pdfjs.TextLayer({ textContentSource: sourceForLayer as never, container: el, viewport });
      await layer.render();
      if (cancelled) return;
      heightPtRef.current = (page.rotate + entry.rotation) % 360 === 0 ? page.view[3] - page.view[1] : 0; // overlay geometry is only valid unrotated
      applyHidden();
    })().catch((err) => console.error("text layer failed", err));
    return () => { cancelled = true; layer?.cancel(); };
  }, [source, entry.sourcePageIndex, entry.rotation, scale, ocrState?.state, ocrState?.engine, applyHidden]);
  return <div ref={ref} className="textLayer" />;
}
