import { useMemo } from "react";
import type { Edit, EditFont } from "../pdf/types";
import { FONT_CSS, normalizeFont } from "../pdf/fonts";
import { placePieces } from "../edit/layout";
import { usePdfMeasure } from "./usePdfMeasure";
import EditHandles from "./EditHandles";

let ctx: CanvasRenderingContext2D | null = null;
export function measureCss(font: Edit["font"]) {
  return (text: string, size: number) => {
    ctx ??= document.createElement("canvas").getContext("2d");
    if (!ctx) return text.length * size * 0.5;
    ctx.font = FONT_CSS[normalizeFont(font)].replace("1px", `${size}px`);
    return ctx.measureText(text).width;
  };
}

export function overlayTransform(rotation: number, W: number, H: number): string {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return `translate(${H}px,0) rotate(90deg)`;
    case 180: return `translate(${W}px,${H}px) rotate(180deg)`;
    case 270: return `translate(0,${W}px) rotate(270deg)`;
    default: return "none";
  }
}

export default function EditOverlay({ edits, scale, pageHeightPt, pageWidthPt, rotation, selectedEditId, onReopen }: { edits: Edit[]; scale: number; pageHeightPt: number; pageWidthPt: number; rotation: number; selectedEditId?: string | null; onReopen?: (e: Edit) => void }) {
  const W = pageWidthPt * scale, H = pageHeightPt * scale;
  // Canvas measurer until the pdf-lib metrics (shared with export) are ready.
  const faces = useMemo(() => [...new Set(edits.flatMap((e) => (e.kind === "line" ? (e.runs ?? []).map((r) => r.font) : [normalizeFont(e.font)])))], [edits]);
  const pdfMeasure = usePdfMeasure(faces);
  const laid = useMemo(() => {
    const measures = (f: EditFont) => pdfMeasure[f] ?? measureCss(f);
    return edits.map((e) => ({ e, ...placePieces(e, measures) }));
  }, [edits, pdfMeasure]);
  return (
    <div className="editOverlay" style={{ width: W, height: H, inset: "auto", left: 0, top: 0, transformOrigin: "0 0", transform: overlayTransform(rotation, W, H) }}>
      {laid.map(({ e, pieces, boxes }) => (
        <div key={e.id} className="edit" data-edit-id={e.id}>
          {boxes.map((b, i) => (
            <div key={i} className="edit-box" style={{ left: b.x * scale, top: (pageHeightPt - b.y - b.height) * scale, width: b.width * scale, height: b.height * scale, background: `rgb(${(e.background ?? [1, 1, 1]).map((c) => c * 255).join(",")})` }} />
          ))}
          {pieces.map((p, i) => (
            <div key={i} className="edit-line" data-run style={{ left: p.x * scale, top: (pageHeightPt - p.baseline - p.fontSize) * scale, font: FONT_CSS[p.font].replace("1px", `${p.fontSize * scale}px`), color: `rgb(${p.color.map((c) => c * 255).join(",")})` }}>{p.text}</div>
          ))}
        </div>
      ))}
      {onReopen ? edits.filter((e) => e.id === selectedEditId).map((e) => <EditHandles key={e.id} edit={e} scale={scale} heightPt={pageHeightPt} onReopen={onReopen} />) : null}
    </div>
  );
}
