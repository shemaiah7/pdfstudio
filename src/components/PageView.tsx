import { useDocumentStore } from "../store/document";
import PageCanvas from "./PageCanvas";
import TextLayer from "./TextLayer";

interface Props { scale: number }

export default function PageView({ scale }: Props) {
  const pages = useDocumentStore((s) => s.pages);
  const sources = useDocumentStore((s) => s.sources);
  const selection = useDocumentStore((s) => s.selection);
  const select = useDocumentStore((s) => s.select);

  return (
    <main className="pageview">
      {pages.map((entry, i) => {
        const source = sources.get(entry.sourceId)!;
        return (
          <div key={entry.id} id={`page-${entry.id}`}
            className={`page ${selection.has(entry.id) ? "selected" : ""}`}
            data-page-entry={entry.id} data-scale={scale} data-rotation={entry.rotation}
            onClick={(e) => { if (window.getSelection()?.isCollapsed) select([entry.id], e.metaKey || e.ctrlKey ? "toggle" : "replace"); }}>
            <PageCanvas source={source} entry={entry} scale={scale} lazy />
            <TextLayer source={source} entry={entry} scale={scale} />
            <div className="page-label">{i + 1}</div>
          </div>
        );
      })}
    </main>
  );
}
