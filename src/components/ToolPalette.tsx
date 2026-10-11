import { useEffect, useState } from "react";
import { useToolsStore, COLORS, WIDTHS, type Tool } from "../store/tools";
import { useDocumentStore } from "../store/document";
import SignatureDialog from "./SignatureDialog";

const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Select" }, { id: "edit", label: "Edit text" }, { id: "highlight", label: "Highlight" }, { id: "note", label: "Note" }, { id: "ink", label: "Draw" },
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
    <div className="palette">
      {TOOLS.map((t) => <button key={t.id} data-testid={`tool-${t.id}`} className={tool === t.id ? "active" : ""} onClick={() => chooseTool(t.id)}>{t.label}</button>)}
      <span className="sep" />
      {COLORS.map((c) => <button key={c.name} data-testid={`color-${c.name}`} title={c.name} className={`swatch ${c.rgb.every((v, i) => v === color[i]) ? "active" : ""}`} style={{ background: `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(",")})` }} onClick={() => pickColor(c.rgb)} />)}
      <span className="sep" />
      {WIDTHS.map((w) => <button key={w.name} data-testid={`width-${w.name}`} className={width === w.value ? "active" : ""} onClick={() => pickWidth(w.value)}>{w.name}</button>)}
      {signing ? <SignatureDialog onConfirm={(png) => { setTool("sign"); setPendingSignature(png); setSigning(false); }} onClose={() => { setSigning(false); if (!useToolsStore.getState().pendingSignature) setTool("select"); }} /> : null}
      {message ? <span className="toolmessage" data-testid="tool-message" role="status">{message}</span> : null}
    </div>
  );
}
