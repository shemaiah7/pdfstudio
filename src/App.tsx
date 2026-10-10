import { useCallback, useEffect, useState } from "react";
import { useDocumentStore } from "./store/document";
import DropZone from "./components/DropZone";
import ThumbnailSidebar from "./components/ThumbnailSidebar";
import PageView from "./components/PageView";
import Toolbar from "./components/Toolbar";
import ErrorBanner from "./components/ErrorBanner";

async function toBytes(files: File[]) {
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export default function App() {
  const pages = useDocumentStore((s) => s.pages);
  const openFiles = useDocumentStore((s) => s.openFiles);
  const addFiles = useDocumentStore((s) => s.addFiles);
  const setError = useDocumentStore((s) => s.setError);
  const [scale, setScale] = useState(1.2);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const on = (e: globalThis.DragEvent) => { e.preventDefault(); setDragging(true); };
    const off = () => setDragging(false);
    window.addEventListener("dragover", on);
    window.addEventListener("dragleave", off);
    window.addEventListener("drop", off);
    return () => { window.removeEventListener("dragover", on); window.removeEventListener("dragleave", off); window.removeEventListener("drop", off); };
  }, []);

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

  const handleFiles = useCallback(async (files: File[], mode: "open" | "add" | "auto" = "auto") => {
    if (files.length === 0) return;
    const empty = useDocumentStore.getState().pages.length === 0;
    const useOpen = mode === "open" || (mode === "auto" && empty);
    const res = await (useOpen ? openFiles : addFiles)(await toBytes(files));
    const msgs: string[] = [];
    if (res.skipped.length) msgs.push(`Couldn't read ${res.skipped.join(", ")} as a PDF.`);
    if (res.oversized.length) msgs.push(`${res.oversized.join(", ")} is very large; editing may be slow.`);
    if (msgs.length) setError(msgs.join(" "));
  }, [openFiles, addFiles, setError]);

  const empty = pages.length === 0;
  return (
    <div className="app">
      <ErrorBanner />
      {empty ? <DropZone onFiles={handleFiles} empty /> : (
        <>
        <Toolbar scale={scale} setScale={setScale} onFiles={handleFiles} />
        <div className="workspace">
          <ThumbnailSidebar />
          <PageView scale={scale} />
          <aside className="rightpanel" />
          <DropZone onFiles={handleFiles} empty={false} forceOver={dragging} />
        </div>
        </>
      )}
    </div>
  );
}
