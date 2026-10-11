import { useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { buildDocument } from "../pdf/pageOps";
import { useFields } from "./useFields";
import { useOcrStore, pageKey } from "../store/ocr";
import { ocrStore } from "../ocr/store";
import type { OcrPage } from "../ocr/types";
import { outputName, saveBlob } from "../pdf/download";

interface Props { scale: number; setScale: (s: number) => void; onFiles: (files: File[], mode: "open" | "add") => void }

export default function Toolbar({ scale, setScale, onFiles }: Props) {
  const s = useDocumentStore();
  const [busy, setBusy] = useState(false);
  const openInput = useRef<HTMLInputElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const selected = [...s.selection];
  const hasSel = selected.length > 0;
  const firstName = s.pages[0] ? s.sources.get(s.pages[0].sourceId)!.name : "document.pdf";

  const firstSource = s.pages[0] ? s.sources.get(s.pages[0].sourceId) : undefined;
  const firstFields = useFields(firstSource);

  const exportPages = async (entries: typeof s.pages, kind: "edited" | "pages") => {
    const ids = new Set(entries.map((p) => p.id));
    setBusy(true);
    try {
      const ocrPages = new Map<string, OcrPage>();
      const ocrState = useOcrStore.getState().pages;
      for (const p of entries) {
        const src = s.sources.get(p.sourceId);
        if (!src?.hash || ocrState[pageKey(p.sourceId, p.sourcePageIndex)]?.state !== "done") continue;
        const page = await ocrStore.get(src.hash, p.sourcePageIndex);
        if (page) ocrPages.set(p.id, page);
      }
      const bytes = await buildDocument(s.sources, entries, s.edits.filter((e) => ids.has(e.pageEntryId)), s.annotations.filter((a) => ids.has(a.pageEntryId)), s.formValues, (msg) => s.setError(msg), ocrPages);
      saveBlob(bytes, outputName(firstName, kind));
      if (kind === "edited") s.markClean();
    } catch (err) {
      s.setError(`Couldn't build the PDF: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = (ref: React.RefObject<HTMLInputElement | null>, mode: "open" | "add") => (
    <input ref={ref} type="file" accept="application/pdf" multiple hidden
      onChange={(e) => { onFiles(Array.from(e.target.files ?? []), mode); e.target.value = ""; }} />
  );

  return (
    <header className="toolbar">
      <button data-testid="open" onClick={() => openInput.current?.click()}>Open</button>
      {pick(openInput, "open")}
      <button data-testid="add" onClick={() => addInput.current?.click()}>Add file</button>
      {pick(addInput, "add")}
      <span className="sep" />
      <button data-testid="undo" disabled={!s.canUndo()} onClick={s.undo}>Undo</button>
      <button data-testid="redo" disabled={!s.canRedo()} onClick={s.redo}>Redo</button>
      <span className="sep" />
      <button data-testid="rotate-left" disabled={!hasSel} onClick={() => s.rotate(selected, -90)}>Rotate ⟲</button>
      <button data-testid="rotate-right" disabled={!hasSel} onClick={() => s.rotate(selected, 90)}>Rotate ⟳</button>
      <button data-testid="delete" disabled={!hasSel} onClick={() => s.remove(selected)}>Delete</button>
      <button data-testid="extract" disabled={!hasSel || busy}
        onClick={() => exportPages(s.pages.filter((p) => s.selection.has(p.id)), "pages")}>Extract selected</button>
      {firstSource && firstFields && firstFields.length > 0 ? (
        <button data-testid="clear-form" onClick={() => s.clearForm(firstSource.id, firstFields)}>Clear form</button>
      ) : null}
      <span className="sep" />
      <button data-testid="zoom-out" onClick={() => setScale(Math.max(0.4, scale - 0.2))}>−</button>
      <span className="zoom">{Math.round(scale * 100)}%</span>
      <button data-testid="zoom-in" onClick={() => setScale(Math.min(3, scale + 0.2))}>+</button>
      <span className="grow" />
      <span className="count">{s.pages.length} page{s.pages.length === 1 ? "" : "s"}{s.isDirty() ? " • unsaved" : ""}</span>
      <button data-testid="download" className="primary" disabled={s.pages.length === 0 || busy}
        onClick={() => exportPages(s.pages, "edited")}>{busy ? "Building…" : "Download"}</button>
    </header>
  );
}
