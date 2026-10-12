import { useRef, useState } from "react";
import type { Edit, EditFont } from "../pdf/types";
import { EDIT_FONTS, fontFamily, normalizeFont } from "../pdf/fonts";
import { regionOf } from "../pdf/layout";
import { lineFrame, placePieces } from "../edit/layout";
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
  const seq = useRef(0); // latest-wins: a slower measurer lookup must not overwrite a newer change
  const frame = lineFrame(edit);

  const start = (mode: Mode) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesture.current = { mode, startX: e.clientX, startY: e.clientY };
    setPreview({ dx: 0, dy: 0 });
    setActive(mode);
  };
  const delta = (e: React.PointerEvent<HTMLElement>, g: Gesture) => ({ dx: (e.clientX - g.startX) / scale, dy: -(e.clientY - g.startY) / scale });
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (g && e.buttons !== 0) setPreview(delta(e, g));
  };
  const cancel = () => {
    gesture.current = null;
    setActive(null);
    setPreview({ dx: 0, dy: 0 });
  };
  const changeFont = async (font: EditFont) => {
    const mine = ++seq.current;
    const m = await measureFor(font);
    const cur = useDocumentStore.getState().edits.find((x) => x.id === edit.id);
    if (!cur || mine !== seq.current) return;
    const region = cur.region ?? regionOf(cur.boxes);
    useDocumentStore.getState().updateEdit(cur.id, { font, region, boxes: placePieces({ ...cur, region }, () => m).boxes });
  };
  const end = async (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setActive(null);
    const { dx, dy } = delta(e, g);
    setPreview({ dx: 0, dy: 0 });
    if (g.mode === "drag" ? dx === 0 && dy === 0 : dx === 0) return;
    const mine = ++seq.current;
    const m = await measureFor(normalizeFont(useDocumentStore.getState().edits.find((x) => x.id === edit.id)?.font ?? edit.font));
    const cur = useDocumentStore.getState().edits.find((x) => x.id === edit.id);
    if (!cur || mine !== seq.current) return;
    // `region` stays the original block; only the text frame moves or resizes, and the covers keep the original region.
    const region = cur.region ?? regionOf(cur.boxes);
    const base = cur.frame ?? region;
    const next = g.mode === "drag" ? { ...base, x: base.x + dx, y: base.y + dy } : { ...base, width: Math.max(cur.fontSize, base.width + dx) };
    useDocumentStore.getState().updateEdit(cur.id, { region, frame: next, boxes: placePieces({ ...cur, region, frame: next }, () => m).boxes });
  };

  const widthPreview = active === "width" ? preview.dx : 0;
  const movePreview = active === "drag" ? preview : { dx: 0, dy: 0 };
  const style: React.CSSProperties = {
    position: "absolute",
    left: (frame.x + movePreview.dx) * scale,
    top: (heightPt - frame.y - frame.height - movePreview.dy) * scale,
    width: (frame.width + widthPreview) * scale,
    height: frame.height * scale,
  };
  const font = normalizeFont(edit.font);
  return (
    <div className="edit-handles" style={style} data-edit-handles={edit.id}>
      <div className="edit-body" data-testid="edit-body" style={{ inset: 0 }} onClick={(e) => { e.stopPropagation(); onReopen(edit); }} />
      <div className="edit-handles-bar" onClick={(e) => e.stopPropagation()}>
        <span className="edit-drag" data-testid="edit-drag" title="Drag to move" onPointerDown={start("drag")} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel}>⠿</span>
        {edit.kind !== "line" && <select data-testid="edit-font" value={font} onChange={(e) => void changeFont(e.target.value as EditFont)}>
          {FAMILIES.map((f) => (
            <optgroup key={f.key} label={f.label}>
              {EDIT_FONTS.filter((n) => fontFamily(n) === f.key).map((n) => <option key={n} value={n}>{n.includes("-") ? n.split("-")[1] : "regular"}</option>)}
            </optgroup>
          ))}
        </select>}
        <button type="button" data-testid="edit-delete" onClick={() => useDocumentStore.getState().removeEdit(edit.id)}>Delete</button>
      </div>
      <div className="edit-width" data-testid="edit-width" title="Drag to change width" onPointerDown={start("width")} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel} />
    </div>
  );
}
