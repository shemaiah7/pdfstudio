import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Annotation, AnnotationPatch, RGB } from "../pdf/types";
import { normalizeBox, pdfToLocal, pointerToPdf, type PageMeta } from "../pdf/geometry";
import { useDocumentStore } from "../store/document";
import { useToolsStore } from "../store/tools";
import { overlayTransform } from "./EditOverlay";
import { boundsOf, moveAnnotation, resizeAnnotation, type Handle } from "./annotationHandles";
import NotePopover from "./NotePopover";
import { useDrawingTool, DRAWING_TOOLS } from "./useDrawingTool";
import { fitSignatureOnPage } from "../signature/image";

interface Props { pageEntryId: string; annotations: Annotation[]; meta: PageMeta; pageEl: () => HTMLElement | null }

type Drag = { id: string; mode: "move" | Handle; start: { x: number; y: number }; dx: number; dy: number; moved: boolean };

const css = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
const patchFrom = (a: Annotation): AnnotationPatch => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, kind, pageEntryId, ...rest } = a;
  return rest as AnnotationPatch;
};
const HANDLES: Handle[] = ["nw", "ne", "sw", "se"];
const RESIZABLE = new Set(["freetext", "signature", "shape"]);

function FreeTextBox({ a, scale, heightPt, rotation, interactive, selected, onPointerDown, onPointerUp }: {
  a: Extract<Annotation, { kind: "freetext" }>; scale: number; heightPt: number; rotation: number; interactive: boolean; selected: boolean;
  onPointerDown(e: React.PointerEvent): void; onPointerUp(e: React.PointerEvent): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { updateAnnotation, removeAnnotation } = useDocumentStore.getState();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== a.text) el.textContent = a.text;
  }, [a.text]);
  useEffect(() => { if (a.text === "") ref.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const b = a.box;
  // The box is in unrotated page space; the text is laid out upright in the viewer's frame and counter-rotated about the box centre.
  const sideways = rotation % 180 !== 0;
  const vw = (sideways ? b.height : b.width) * scale, vh = (sideways ? b.width : b.height) * scale;
  const cx = (b.x + b.width / 2) * scale, cy = (heightPt - b.y - b.height / 2) * scale;
  return (
    <div ref={ref} className={`freetext hit${selected ? " selected" : ""}`} data-annotation-id={a.id}
      contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
      style={{ left: cx - vw / 2, top: cy - vh / 2, width: vw, minHeight: vh, transform: rotation ? `rotate(${-rotation}deg)` : undefined, fontSize: a.fontSize * scale, color: css(a.color), pointerEvents: interactive ? "auto" : "none" }}
      onPointerDown={(e) => { if (document.activeElement !== e.currentTarget) onPointerDown(e); }}
      onPointerUp={onPointerUp}
      onBlur={(e) => {
        const text = e.currentTarget.textContent ?? "";
        if (text.trim() === "") removeAnnotation(a.id);
        else if (text !== a.text) updateAnnotation(a.id, { text });
      }} />
  );
}

export default function AnnotationOverlay({ pageEntryId, annotations, meta, pageEl }: Props) {
  const { widthPt, heightPt, scale, rotation } = meta;
  const W = widthPt * scale, H = heightPt * scale;
  const selectedId = useDocumentStore((s) => s.selectedAnnotationId);
  const tool = useToolsStore((s) => s.tool);
  const interactive = tool === "select";
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const color = useToolsStore((s) => s.color);
  const toolWidth = useToolsStore((s) => s.width);
  const pendingSignature = useToolsStore((s) => s.pendingSignature);
  const drawing = DRAWING_TOOLS.includes(tool);
  const placing = tool === "sign" && !!pendingSignature;
  const placeSignature = (e: React.PointerEvent) => {
    const el = pageEl(), png = pendingSignature;
    if (e.button !== 0 || !el || !png) return;
    e.preventDefault();
    const p = pointerToPdf(e, el, meta);
    useToolsStore.getState().setPendingSignature(null);
    const img = new Image();
    img.onerror = () => useToolsStore.getState().setTool("select");
    img.onload = () => {
      const f = fitSignatureOnPage(img.naturalWidth, img.naturalHeight, widthPt, heightPt, rotation);
      const box = { x: Math.min(Math.max(0, p.x - f.width / 2), Math.max(0, widthPt - f.width)), y: Math.min(Math.max(0, p.y - f.height / 2), Math.max(0, heightPt - f.height)), width: f.width, height: f.height };
      const { addAnnotation, selectAnnotation } = useDocumentStore.getState();
      const id = addAnnotation({ kind: "signature", pageEntryId, box, png, color: [0, 0, 0] });
      useToolsStore.getState().setTool("select");
      selectAnnotation(id);
    };
    img.src = png;
  };
  const { state: ds, handlers: dh } = useDrawingTool(pageEntryId, meta, pageEl, tool, { color, width: toolWidth, fontSize: 12 },
    (id, a) => { if (a.kind === "note") setOpenNote(id); });

  // Only close if this popover's note is still the open one (a newer note may have replaced it in the same batch).
  const closeNote = (id: string) => setOpenNote((cur) => (cur === id ? null : cur));
  const setD = (d: Drag | null) => { dragRef.current = d; setDrag(d); };
  const apply = (a: Annotation): Annotation => {
    if (!drag || drag.id !== a.id) return a;
    return drag.mode === "move" ? moveAnnotation(a, drag.dx, drag.dy) : resizeAnnotation(a, drag.mode, drag.dx, drag.dy);
  };
  const shown = annotations.map(apply);

  const begin = (e: React.PointerEvent, a: Annotation, mode: Drag["mode"]) => {
    if (!interactive || e.button !== 0) return;
    const el = pageEl();
    if (!el) return;
    e.stopPropagation();
    if (!(e.target instanceof HTMLElement && e.target.isContentEditable)) e.preventDefault();
    useDocumentStore.getState().selectAnnotation(a.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setD({ id: a.id, mode, start: pointerToPdf(e, el, meta), dx: 0, dy: 0, moved: false });
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current, el = pageEl();
    if (!d || !el) return;
    const p = pointerToPdf(e, el, meta);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    setD({ ...d, dx, dy, moved: d.moved || Math.hypot(dx, dy) * scale > 3 });
  };
  const end = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setD(null);
    const a = annotations.find((x) => x.id === d.id);
    if (!a) return;
    if (d.moved) {
      const next = d.mode === "move" ? moveAnnotation(a, d.dx, d.dy) : resizeAnnotation(a, d.mode, d.dx, d.dy);
      useDocumentStore.getState().updateAnnotation(a.id, patchFrom(next));
    } else if (d.mode === "move") {
      if (a.kind === "note") setOpenNote(a.id);
      else if (a.kind === "freetext") (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-annotation-id="${a.id}"]`)?.focus();
    }
  };

  const hit = (a: Annotation) => ({ className: "hit", style: { pointerEvents: interactive ? ("auto" as const) : ("none" as const) }, onPointerDown: (e: React.PointerEvent) => begin(e, a, "move"), "data-annotation-id": a.id });

  const renderSvg = (a: Annotation) => {
    const col = css(a.color);
    switch (a.kind) {
      case "highlight":
        return <g key={a.id} {...hit(a)}>{a.boxes.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} fill={col} fillOpacity={0.4} style={{ mixBlendMode: "multiply" }} />)}</g>;
      case "ink": {
        const ds = a.strokes.map((s) => s.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "));
        return <g key={a.id} {...hit(a)}>{ds.map((d, i) => (<g key={i}>
          <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(a.width, 8)} strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" stroke={col} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" />
        </g>))}</g>;
      }
      case "shape": {
        if (a.shape === "rect") {
          const b = boundsOf(a);
          return <g key={a.id} {...hit(a)}>
            <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke="transparent" strokeWidth={Math.max(a.width, 8)} />
            <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke={col} strokeWidth={a.width} />
          </g>;
        }
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), hl = 6 + a.width * 2;
        const h1 = `${a.x2 - hl * Math.cos(ang - Math.PI / 6)},${a.y2 - hl * Math.sin(ang - Math.PI / 6)}`;
        const h2 = `${a.x2 - hl * Math.cos(ang + Math.PI / 6)},${a.y2 - hl * Math.sin(ang + Math.PI / 6)}`;
        return <g key={a.id} {...hit(a)}>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={Math.max(a.width, 8)} />
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={col} strokeWidth={a.width} strokeLinecap="round" />
          <polyline points={`${h1} ${a.x2},${a.y2} ${h2}`} fill="none" stroke={col} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" />
        </g>;
      }
      case "note":
        return <g key={a.id} {...hit(a)} transform={`translate(${a.x},${a.y})`}>
          <rect width={20} height={20} rx={3} fill={col} />
          <rect x={4} y={6} width={12} height={2} fill="white" />
          <rect x={4} y={11} width={9} height={2} fill="white" />
        </g>;
      case "signature":
      {
        const sideways = rotation % 180 !== 0, vw = sideways ? a.box.height : a.box.width, vh = sideways ? a.box.width : a.box.height;
        const cx = a.box.x + a.box.width / 2, cy = a.box.y + a.box.height / 2;
        return <g key={a.id} {...hit(a)}><image href={a.png} x={-vw / 2} y={-vh / 2} width={vw} height={vh} transform={`translate(${cx},${cy}) rotate(${rotation}) scale(1,-1)`} preserveAspectRatio="xMidYMid meet" /></g>;
      }
      default:
        return null;
    }
  };

  const renderPreview = () => {
    const st = ds.start!, cur = ds.current!, col = css(color);
    if (tool === "ink") return <path d={ds.points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ")} fill="none" stroke={col} strokeWidth={toolWidth} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />;
    if (tool === "rect") { const b = normalizeBox(st.x, st.y, cur.x, cur.y); return <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke={col} strokeWidth={toolWidth} pointerEvents="none" />; }
    if (tool === "arrow") return <line x1={st.x} y1={st.y} x2={cur.x} y2={cur.y} stroke={col} strokeWidth={toolWidth} strokeLinecap="round" pointerEvents="none" />;
    if (tool === "freetext") { const b = normalizeBox(st.x, st.y, cur.x, cur.y); return <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke="var(--accent)" strokeWidth={1 / scale} strokeDasharray={`${4 / scale} ${3 / scale}`} pointerEvents="none" />; }
    return null;
  };

  const sel = shown.find((a) => a.id === selectedId);
  const hs = 8 / scale;
  const note = openNote ? shown.find((a) => a.id === openNote && a.kind === "note") : undefined;
  const notePos = note && note.kind === "note" ? pdfToLocal(note.x + 20, note.y, meta) : null;

  return (
    <>
      <div className="annotationOverlay" {...(placing ? { onPointerDown: placeSignature } : drawing ? dh : { onPointerMove: onMove, onPointerUp: end, onPointerCancel: end })}
        style={{ width: W, height: H, inset: "auto", left: 0, top: 0, transformOrigin: "0 0", transform: overlayTransform(rotation, W, H), pointerEvents: drawing || placing ? "auto" : "none", touchAction: drawing ? "none" : undefined, cursor: drawing || placing ? "crosshair" : undefined }}>
        {shown.map((a) => a.kind === "freetext" ? (
          <FreeTextBox key={a.id} a={a} scale={scale} heightPt={heightPt} rotation={rotation} interactive={interactive} selected={a.id === selectedId}
            onPointerDown={(e) => begin(e, a, "move")} onPointerUp={() => undefined} />
        ) : null)}
        <svg width={W} height={H}>
          <g transform={`scale(${scale}) translate(0, ${heightPt}) scale(1,-1)`}>
            {shown.map(renderSvg)}
            {ds.active && ds.start && ds.current ? renderPreview() : null}
            {sel && interactive ? (() => {
              const b = boundsOf(sel);
              return <g>
                <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke="var(--accent)" strokeWidth={1 / scale} strokeDasharray={`${4 / scale} ${3 / scale}`} pointerEvents="none" />
                {RESIZABLE.has(sel.kind) ? HANDLES.map((h) => {
                  const hx = h.includes("e") ? b.x + b.width : b.x, hy = h.includes("n") ? b.y + b.height : b.y;
                  return <rect key={h} className="handle" data-handle={h} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} strokeWidth={1 / scale}
                    style={{ pointerEvents: "auto", cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize" }}
                    onPointerDown={(e) => begin(e, sel, h)} />;
                }) : null}
              </g>;
            })() : null}
          </g>
        </svg>
      </div>
      {note && note.kind === "note" && notePos ? (
        <NotePopover key={note.id} left={notePos.lx + 4} top={notePos.ly} text={note.text}
          onDone={(text) => { useDocumentStore.getState().updateAnnotation(note.id, { text }); closeNote(note.id); }}
          onDelete={() => { useDocumentStore.getState().removeAnnotation(note.id); closeNote(note.id); }}
          onClose={() => closeNote(note.id)} />
      ) : null}
    </>
  );
}
