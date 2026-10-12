import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useDocumentStore } from "../store/document";
import Thumbnail from "./Thumbnail";

export default function ThumbnailSidebar({ open = false, onPick }: { open?: boolean; onPick?: () => void }) {
  const pages = useDocumentStore((s) => s.pages);
  const sources = useDocumentStore((s) => s.sources);
  const selection = useDocumentStore((s) => s.selection);
  const select = useDocumentStore((s) => s.select);
  const reorder = useDocumentStore((s) => s.reorder);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const ids = selection.has(activeId) ? pages.filter((p) => selection.has(p.id)).map((p) => p.id) : [activeId];
    const from = pages.findIndex((p) => p.id === activeId);
    const to = pages.findIndex((p) => p.id === over.id);
    reorder(ids, to > from ? to + 1 : to);
  };

  const onClick = (id: string, index: number) => (e: React.MouseEvent) => {
    if (e.shiftKey && selection.size > 0) {
      const anchor = pages.findIndex((p) => selection.has(p.id));
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      select(pages.slice(a, b + 1).map((p) => p.id), "replace");
    } else if (e.metaKey || e.ctrlKey) {
      select([id], "toggle");
    } else {
      select([id], "replace");
      onPick?.();
    }
    document.getElementById(`page-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-head">
        <span className="sidebar-title">Pages</span>
        <span className="sidebar-meta">{selection.size > 0 ? `${selection.size} selected` : `${pages.length} page${pages.length === 1 ? "" : "s"}`}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          {pages.map((entry, i) => (
            <Thumbnail key={entry.id} entry={entry} source={sources.get(entry.sourceId)!} index={i}
              selected={selection.has(entry.id)} multiSource={sources.size > 1} onClick={onClick(entry.id, i)} />
          ))}
        </SortableContext>
      </DndContext>
    </aside>
  );
}
