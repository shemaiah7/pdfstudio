import { useEffect, useRef } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PageEntry, SourceFile } from "../pdf/types";
import { getPage } from "../pdf/render";

interface Props { source: SourceFile; entry: PageEntry; scale: number }

export default function TextLayer({ source, entry, scale }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    el.replaceChildren();
    (async () => {
      const page = await getPage(source, entry.sourcePageIndex);
      if (cancelled) return;
      const viewport = page.getViewport({ scale, rotation: page.rotate + entry.rotation });
      el.style.setProperty("--scale-factor", String(scale));
      el.style.width = `${Math.floor(viewport.width)}px`;
      el.style.height = `${Math.floor(viewport.height)}px`;
      const layer = new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: el, viewport });
      if (cancelled) return;
      await layer.render();
    })().catch((err) => console.error("text layer failed", err));
    return () => { cancelled = true; };
  }, [source, entry.sourcePageIndex, entry.rotation, scale]);
  return <div ref={ref} className="textLayer" />;
}
