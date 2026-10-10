import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PageCanvas from "./PageCanvas";
import type { PageEntry, SourceFile } from "../pdf/types";

interface Props {
  entry: PageEntry; source: SourceFile; index: number; selected: boolean; multiSource: boolean;
  onClick: (e: React.MouseEvent) => void;
}

export default function Thumbnail({ entry, source, index, selected, multiSource, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`thumb ${selected ? "selected" : ""}`} data-testid="thumb" data-page-id={entry.id}
      title={multiSource ? source.name : undefined} onClick={onClick}>
      <PageCanvas source={source} entry={entry} scale={0.3} lazy />
      <div className="thumb-label">{index + 1}</div>
    </div>
  );
}
