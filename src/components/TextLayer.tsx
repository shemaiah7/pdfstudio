import { useEffect, useRef } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PageEntry, SourceFile } from "../pdf/types";
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

export default function TextLayer({ source, entry, scale }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const ocrState = useOcrStore((s) => s.pages[pageKey(source.id, entry.sourcePageIndex)]);
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
    })().catch((err) => console.error("text layer failed", err));
    return () => { cancelled = true; layer?.cancel(); };
  }, [source, entry.sourcePageIndex, entry.rotation, scale, ocrState?.state, ocrState?.engine]);
  return <div ref={ref} className="textLayer" />;
}
