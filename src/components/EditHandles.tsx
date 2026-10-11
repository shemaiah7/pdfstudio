import { useRef, useState } from "react";
import type { Edit, EditFont } from "../pdf/types";
import { EDIT_FONTS, fontFamily, normalizeFont } from "../pdf/fonts";
import { regionOf } from "../pdf/layout";
import { layoutBlock, coverBoxes } from "../edit/layout";
import { measureFor } from "../pdf/metrics";
import { useDocumentStore } from "../store/document";

const FAMILIES: { key: "helvetica" | "times" | "courier"; label: string }[] = [{ key: "helvetica", label: "Helvetica" }, { key: "times", label: "Times" }, { key: "courier", label: "Courier" }];

type Mode = "drag" | "width";
interface Gesture { mode: Mode; startX: number; startY: number }

/** Controls for an existing edit: delete, font menu, drag-to-move, right-edge width, and a body that reopens it. */
export default function EditHandles({ edit, scale, heightPt, onReopen }: { edit: Edit; scale: number; heightPt: number; onReopen: (e: Edit) => void }) {
  const [preview, setPreview] = useState({ dx: 0, dy: 0 });
  const [active, setActive] = useState<Mode | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const region = regionOf(edit.boxes);

  const start = (mode: Mode) => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesture.current = { mode, startX: e.clientX, startY: e.clientY };
    setPreview({ dx: 0, dy: 0 });
    setActive(mode);
  };
  const delta = (e: React.PointerEvent<HTMLElement>, g: Gesture) => ({ dx: (e.clientX - g.startX) / scale, dy: -(e.clientY - g.startY) / scale });
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (g) setPreview(delta(e, g));
  };
  const end = async (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setActive(null);
    const { dx, dy } = delta(e, g);
    setPreview({ dx: 0, dy: 0 });
    const { edits, updateEdit } = useDocumentStore.getState();
    const cur = edits.find((x) => x.id === edit.id);
    if (!cur) return;
    if (g.mode === "drag") {
      if (dx === 0 && dy === 0) return;
      const r = cur.region;
      updateEdit(cur.id, { boxes: cur.boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })), ...(r ? { region: { ...r, x: r.x + dx, y: r.y + dy } } : {}) });
      return;
    }
    if (dx === 0) return;
    const base = cur.region ?? regionOf(cur.boxes);
    const width = Math.max(cur.fontSize, base.width + dx);
    const nextRegion = { ...base, width };
    const m = await measureFor(normalizeFont(cur.font));
    const lay = layoutBlock(cur.text, nextRegion, cur.fontSize, cur.lineHeight ?? cur.fontSize * 1.2, m);
    useDocumentStore.getState().updateEdit(cur.id, { boxes: coverBoxes(lay, nextRegion), region: nextRegion });
  };

  const widthPreview = active === "width" ? preview.dx : 0;
  const movePreview = active === "drag" ? preview : { dx: 0, dy: 0 };
  const style: React.CSSProperties = {
    position: "absolute",
    left: (region.x + movePreview.dx) * scale,
    top: (heightPt - region.y - region.height - movePreview.dy) * scale,
    width: (region.width + widthPreview) * scale,
    height: region.height * scale,
  };
  const font = normalizeFont(edit.font);
  return (
    <div className="edit-handles" style={style} data-edit-handles={edit.id}>
      <div className="edit-body" data-testid="edit-body" style={{ inset: 0 }} onClick={(e) => { e.stopPropagation(); onReopen(edit); }} />
      <div className="edit-handles-bar" onClick={(e) => e.stopPropagation()}>
        <span className="edit-drag" data-testid="edit-drag" title="Drag to move" onPointerDown={start("drag")} onPointerMove={move} onPointerUp={end}>⠿</span>
        <select data-testid="edit-font" value={font} onChange={(e) => useDocumentStore.getState().updateEdit(edit.id, { font: e.target.value as EditFont })}>
          {FAMILIES.map((f) => (
            <optgroup key={f.key} label={f.label}>
              {EDIT_FONTS.filter((n) => fontFamily(n) === f.key).map((n) => <option key={n} value={n}>{n.includes("-") ? n.split("-")[1] : "regular"}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" data-testid="edit-delete" onClick={() => useDocumentStore.getState().removeEdit(edit.id)}>Delete</button>
      </div>
      <div className="edit-width" data-testid="edit-width" title="Drag to change width" onPointerDown={start("width")} onPointerMove={move} onPointerUp={end} />
    </div>
  );
}
