import { useCallback, useEffect, useState } from "react";
import { useDocumentStore } from "./store/document";
import DropZone from "./components/DropZone";
import ThumbnailSidebar from "./components/ThumbnailSidebar";
import PageView from "./components/PageView";
import ErrorBanner from "./components/ErrorBanner";

async function toBytes(files: File[]) {
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export default function App() {
  const pages = useDocumentStore((s) => s.pages);
  const openFiles = useDocumentStore((s) => s.openFiles);
  const addFiles = useDocumentStore((s) => s.addFiles);
  const setError = useDocumentStore((s) => s.setError);
  const [scale] = useState(1.2);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const on = (e: globalThis.DragEvent) => { e.preventDefault(); setDragging(true); };
    const off = () => setDragging(false);
    window.addEventListener("dragover", on);
    window.addEventListener("dragleave", off);
    window.addEventListener("drop", off);
    return () => { window.removeEventListener("dragover", on); window.removeEventListener("dragleave", off); window.removeEventListener("drop", off); };
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const empty = useDocumentStore.getState().pages.length === 0;
    const res = await (empty ? openFiles : addFiles)(await toBytes(files));
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
        <div className="workspace">
          <ThumbnailSidebar />
          <PageView scale={scale} />
          <aside className="rightpanel" />
          <DropZone onFiles={handleFiles} empty={false} forceOver={dragging} />
        </div>
      )}
    </div>
  );
}
