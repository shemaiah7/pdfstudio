import { useMemo } from "react";
import type { Edit } from "../pdf/types";
import { layoutText, regionOf } from "../pdf/layout";

const FONT_CSS: Record<Edit["font"], string> = {
  sans: "400 1px Helvetica, Arial, sans-serif",
  "sans-bold": "700 1px Helvetica, Arial, sans-serif",
  serif: "400 1px 'Times New Roman', Times, serif",
};

let ctx: CanvasRenderingContext2D | null = null;
export function measureCss(font: Edit["font"]) {
  return (text: string, size: number) => {
    ctx ??= document.createElement("canvas").getContext("2d");
    if (!ctx) return text.length * size * 0.5;
    ctx.font = FONT_CSS[font].replace("1px", `${size}px`);
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

export default function EditOverlay({ edits, scale, pageHeightPt, pageWidthPt, rotation }: { edits: Edit[]; scale: number; pageHeightPt: number; pageWidthPt: number; rotation: number }) {
  const W = pageWidthPt * scale, H = pageHeightPt * scale;
  const laid = useMemo(() => edits.map((e) => ({ e, ...layoutText(e.text, regionOf(e.boxes), e.fontSize, measureCss(e.font)) })), [edits]);
  return (
    <div className="editOverlay" style={{ width: W, height: H, inset: "auto", left: 0, top: 0, transformOrigin: "0 0", transform: overlayTransform(rotation, W, H) }}>
      {laid.map(({ e, lines, fontSize }) => (
        <div key={e.id} className="edit" data-edit-id={e.id}>
          {e.boxes.map((b, i) => (
            <div key={i} className="edit-box" style={{ left: b.x * scale, top: (pageHeightPt - b.y - b.height) * scale, width: b.width * scale, height: b.height * scale }} />
          ))}
          {lines.map((l, i) => (
            <div key={i} className="edit-line" style={{ left: l.x * scale, top: (pageHeightPt - l.baseline - fontSize) * scale, font: FONT_CSS[e.font].replace("1px", `${fontSize * scale}px`), color: `rgb(${e.color.map((c) => c * 255).join(",")})` }}>{l.text}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
