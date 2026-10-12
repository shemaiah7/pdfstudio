import { useEffect, useState } from "react";
import { useToolsStore, COLORS, WIDTHS, type Tool } from "../store/tools";
import { useDocumentStore } from "../store/document";
import { Icon } from "./icons";
import SignatureDialog from "./SignatureDialog";

const WIDTH_BAR_PX: Record<string, number> = { thin: 2, medium: 4, thick: 7 };

const TOOLS: { id: Tool; label: string; title?: string }[] = [
  { id: "select", label: "Select" }, { id: "edit", label: "Edit text", title: "Edit text (E)" }, { id: "highlight", label: "Highlight" }, { id: "note", label: "Note" }, { id: "ink", label: "Draw" },
  { id: "rect", label: "Rectangle" }, { id: "arrow", label: "Arrow" }, { id: "freetext", label: "Text box" }, { id: "sign", label: "Sign" },
];

export default function ToolPalette() {
  const { tool, color, width, message, setTool, setColor, setWidth, setPendingSignature } = useToolsStore();
  const [signing, setSigning] = useState(false);
  const chooseTool = (id: Tool) => { setTool(id); if (id === "sign") setSigning(true); };
  const selectedAnnotationId = useDocumentStore((s) => s.selectedAnnotationId);
  const updateAnnotation = useDocumentStore((s) => s.updateAnnotation);
  useEffect(() => {
    const isEditing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTool("select"); useDocumentStore.getState().selectAnnotation(null); }
      else if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditing()) setTool("edit");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool]);
  const pickColor = (rgb: typeof color) => { setColor(rgb); if (selectedAnnotationId) updateAnnotation(selectedAnnotationId, { color: rgb }); };
  const pickWidth = (w: number) => {
    setWidth(w);
    if (!selectedAnnotationId) return;
    const sel = useDocumentStore.getState().annotations.find((a) => a.id === selectedAnnotationId);
    if (sel && (sel.kind === "ink" || sel.kind === "shape")) updateAnnotation(selectedAnnotationId, { width: w });
  };
  return (
    <>
      <div className="palette" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" data-testid={`tool-${t.id}`} className={`tool ${tool === t.id ? "active" : ""}`}
            aria-label={t.label} title={t.title ?? t.label} aria-pressed={tool === t.id} onClick={() => chooseTool(t.id)}>
            <Icon name={t.id} size={19} />
          </button>
        ))}
        <span className="sep" />
        {COLORS.map((c) => {
          const active = c.rgb.every((v, i) => v === color[i]);
          return (
            <button key={c.name} type="button" data-testid={`color-${c.name}`} title={c.name} aria-label={c.name} aria-pressed={active}
              className={`swatch ${active ? "active" : ""}`}
              style={{ "--swatch": c.name === "black" ? "#F2F1EE" : `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(",")})` } as React.CSSProperties}
              onClick={() => pickColor(c.rgb)} />
          );
        })}
        <span className="sep" />
        {WIDTHS.map((w) => (
          <button key={w.name} type="button" data-testid={`width-${w.name}`} className={`width ${width === w.value ? "active" : ""}`}
            aria-label={`${w.name} stroke`} title={w.name} aria-pressed={width === w.value} onClick={() => pickWidth(w.value)}>
            <span className="width-bar" style={{ height: WIDTH_BAR_PX[w.name] ?? 4 }} />
          </button>
        ))}
        {message ? <span className="toolmessage" data-testid="tool-message" role="status">{message}</span> : null}
      </div>
      {signing ? <SignatureDialog onConfirm={(png) => { setTool("sign"); setPendingSignature(png); setSigning(false); }} onClose={() => { setSigning(false); if (!useToolsStore.getState().pendingSignature) setTool("select"); }} /> : null}
    </>
  );
}
