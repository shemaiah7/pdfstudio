import { useCallback, useEffect, useState } from "react";
import { useDocumentStore } from "./store/document";
import DropZone from "./components/DropZone";
import ThumbnailSidebar from "./components/ThumbnailSidebar";
import PageView from "./components/PageView";
import Toolbar from "./components/Toolbar";
import ToolPalette from "./components/ToolPalette";
import ErrorBanner from "./components/ErrorBanner";
import AiPanel from "./components/ai/AiPanel";
import { useAiStore } from "./store/ai";
import { captureSelection } from "./pdf/selection";

async function toBytes(files: File[]) {
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export default function App() {
  const hasSources = useDocumentStore((s) => s.sources.size > 0);
  const openFiles = useDocumentStore((s) => s.openFiles);
  const addFiles = useDocumentStore((s) => s.addFiles);
  const setError = useDocumentStore((s) => s.setError);
  const [scale, setScale] = useState(1.2);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useDocumentStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); st.undo(); }
      else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); st.redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && st.selection.size) { e.preventDefault(); st.remove([...st.selection]); }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useDocumentStore.getState().isDirty()) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", onUnload); };
  }, []);

  useEffect(() => {
    const onSel = () => { const sel = captureSelection(); if (sel) useAiStore.getState().setSelection(sel); };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const handleFiles = useCallback(async (files: File[], mode: "open" | "add" | "auto" = "auto") => {
    if (files.length === 0) return;
    const empty = useDocumentStore.getState().sources.size === 0;
    const useOpen = mode === "open" || (mode === "auto" && empty);
    const res = await (useOpen ? openFiles : addFiles)(await toBytes(files));
    const msgs: string[] = [];
    if (res.skipped.length) msgs.push(`Couldn't read ${res.skipped.join(", ")} as a PDF.`);
    if (res.oversized.length) msgs.push(`${res.oversized.join(", ")} is very large; editing may be slow.`);
    if (msgs.length) setError(msgs.join(" "));
  }, [openFiles, addFiles, setError]);

  useEffect(() => {
    const on = (e: globalThis.DragEvent) => { e.preventDefault(); setDragging(true); };
    const off = () => setDragging(false);
    // Drops that miss the overlay would make the browser navigate to the file; handle them here.
    // The overlay's own onDrop stops propagation, so files are never handled twice.
    const onDrop = (e: globalThis.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void handleFiles(files);
    };
    window.addEventListener("dragover", on);
    window.addEventListener("dragleave", off);
    window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragover", on); window.removeEventListener("dragleave", off); window.removeEventListener("drop", onDrop); };
  }, [handleFiles]);

  const empty = !hasSources;
  return (
    <div className="app">
      <ErrorBanner />
      {empty ? <DropZone onFiles={handleFiles} empty /> : (
        <>
        <Toolbar scale={scale} setScale={setScale} onFiles={handleFiles} />
        <ToolPalette />
        <div className="workspace">
          <ThumbnailSidebar />
          <PageView scale={scale} />
          <aside className="rightpanel"><AiPanel /></aside>
          <DropZone onFiles={handleFiles} empty={false} forceOver={dragging} />
        </div>
        </>
      )}
    </div>
  );
}
