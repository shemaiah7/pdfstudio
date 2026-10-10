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
    let cancelled = false;
    renderPage(source, entry.sourcePageIndex, entry.rotation, scale, ref.current).catch((err) => {
      if (!cancelled) console.error("render failed", err);
    });
    return () => { cancelled = true; };
  }, [visible, source, entry.sourcePageIndex, entry.rotation, scale]);

  return <canvas ref={ref} className={className} data-page-id={entry.id} />;
}
