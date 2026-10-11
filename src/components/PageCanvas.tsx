import { useEffect, useRef, useState } from "react";
import { renderPage } from "../pdf/render";
import type { PageEntry, SourceFile } from "../pdf/types";

interface Props { source: SourceFile; entry: PageEntry; scale: number; className?: string; lazy?: boolean }

export default function PageCanvas({ source, entry, scale, className, lazy = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (!lazy || !ref.current) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [lazy]);

  useEffect(() => {
    if (!visible || !ref.current) return;
    // Cancel the in-flight render on rerender/unmount so tasks never overlap on this canvas.
    const handle = renderPage(source, entry.sourcePageIndex, entry.rotation, scale, ref.current);
    handle.promise.then(() => {
      const canvas = ref.current;
      const pageEl = canvas?.closest(".page");
      if (!canvas || !pageEl || !canvas.dataset.heightPt) return;
      pageEl.setAttribute("data-height-pt", canvas.dataset.heightPt);
      pageEl.setAttribute("data-page-rotate", canvas.dataset.pageRotate ?? "0");
    }).catch((err) => console.error("render failed", err));
    return () => handle.cancel();
  }, [visible, source, entry.sourcePageIndex, entry.rotation, scale]);

  return <canvas ref={ref} className={className} data-page-id={entry.id} />;
}
