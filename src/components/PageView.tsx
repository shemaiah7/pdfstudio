import { useCallback, useState } from "react";
import { useDocumentStore } from "../store/document";
import PageCanvas from "./PageCanvas";
import TextLayer from "./TextLayer";
import EditOverlay from "./EditOverlay";

interface Props { scale: number }

export default function PageView({ scale }: Props) {
  const pages = useDocumentStore((s) => s.pages);
  const sources = useDocumentStore((s) => s.sources);
  const selection = useDocumentStore((s) => s.selection);
  const select = useDocumentStore((s) => s.select);
  const edits = useDocumentStore((s) => s.edits);
  const [heights, setHeights] = useState<Record<string, { widthPt: number; heightPt: number; pageRotate: number }>>({});
  const onMeta = useCallback((id: string, m: { widthPt: number; heightPt: number; pageRotate: number }) => {
    setHeights((h) => {
      const c = h[id];
      return c && c.widthPt === m.widthPt && c.heightPt === m.heightPt && c.pageRotate === m.pageRotate ? h : { ...h, [id]: m };
    });
  }, []);

  return (
    <main className="pageview">
      {pages.map((entry, i) => {
        const source = sources.get(entry.sourceId)!;
        return (
          <div key={entry.id} id={`page-${entry.id}`}
            className={`page ${selection.has(entry.id) ? "selected" : ""}`}
            data-page-entry={entry.id} data-scale={scale} data-rotation={entry.rotation}
            onClick={(e) => { if (window.getSelection()?.isCollapsed) select([entry.id], e.metaKey || e.ctrlKey ? "toggle" : "replace"); }}>
            <PageCanvas source={source} entry={entry} scale={scale} lazy onMeta={(m) => onMeta(entry.id, m)} />
            <TextLayer source={source} entry={entry} scale={scale} />
            {heights[entry.id] ? <EditOverlay edits={edits.filter((e) => e.pageEntryId === entry.id)} scale={scale} pageHeightPt={heights[entry.id].heightPt} pageWidthPt={heights[entry.id].widthPt} rotation={(heights[entry.id].pageRotate + entry.rotation) % 360} /> : null}
            <div className="page-label">{i + 1}</div>
          </div>
        );
      })}
    </main>
  );
}
