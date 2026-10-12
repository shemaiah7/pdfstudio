import { useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { buildDocument } from "../pdf/pageOps";
import { rasterizeWithPdfJs } from "../edit/flatten";
import { extractPageText } from "../pdf/text";
import { useFields } from "./useFields";
import { useOcrStore, pageKey } from "../store/ocr";
import { ocrStore } from "../ocr/store";
import type { OcrPage } from "../ocr/types";
import DeepOcrMenu from "./ocr/DeepOcrMenu";
import OcrPill from "./ocr/OcrPill";
import { Icon, type IconName } from "./icons";
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
      let ocrFailed = false;
      const ocrState = useOcrStore.getState().pages;
      for (const p of entries) {
        const src = s.sources.get(p.sourceId);
        if (!src?.hash || ocrState[pageKey(p.sourceId, p.sourcePageIndex)]?.state !== "done") continue;
        try {
          const page = await ocrStore.get(src.hash, p.sourcePageIndex);
          if (page) ocrPages.set(p.id, page);
        } catch {
          if (!ocrFailed) s.setError("Saved without searchable text layer.");
          ocrFailed = true;
        }
      }
      const bytes = await buildDocument(s.sources, entries, s.edits.filter((e) => ids.has(e.pageEntryId)), s.annotations.filter((a) => ids.has(a.pageEntryId)), s.formValues, (msg) => s.setError(msg), ocrPages, { rasterize: rasterizeWithPdfJs, editedText: async (src, p) => (await extractPageText(src, p)).items });
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

  const ib = (testid: string, icon: IconName, label: string, onClick: () => void, disabled = false, title = label) => (
    <button type="button" className="tb-icon" data-testid={testid} aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );

  return (
    <header className="toolbar">
      <div className="tb-doc">
        <span className="tb-doc-mark"><Icon name="file" size={16} /></span>
        <div className="tb-doc-text">
          <span className="tb-doc-name" title={firstName}>{firstName}</span>
          <span className="count">
            {s.pages.length} page{s.pages.length === 1 ? "" : "s"}
            {s.isDirty() ? <><span className="dot" aria-hidden="true" />unsaved changes</> : null}
          </span>
        </div>
      </div>
      <div className="tb-group">
        {ib("open", "open", "Open", () => openInput.current?.click())}
        {pick(openInput, "open")}
        {ib("add", "add-file", "Add file", () => addInput.current?.click())}
        {pick(addInput, "add")}
      </div>
      <div className="tb-group">
        {ib("undo", "undo", "Undo", s.undo, !s.canUndo(), "Undo (⌘Z)")}
        {ib("redo", "redo", "Redo", s.redo, !s.canRedo(), "Redo (⌘⇧Z)")}
      </div>
      <div className="tb-group">
        {ib("rotate-left", "rotate-left", "Rotate left", () => s.rotate(selected, -90), !hasSel)}
        {ib("rotate-right", "rotate-right", "Rotate right", () => s.rotate(selected, 90), !hasSel)}
        {ib("delete", "delete", "Delete pages", () => s.remove(selected), !hasSel)}
        {ib("extract", "extract", "Extract selected pages", () => exportPages(s.pages.filter((p) => s.selection.has(p.id)), "pages"), !hasSel || busy)}
        {firstSource && firstFields && firstFields.length > 0
          ? ib("clear-form", "clear-form", "Clear form", () => s.clearForm(firstSource.id, firstFields))
          : null}
      </div>
      <DeepOcrMenu />
      <OcrPill />
      <div className="tb-right">
        <div className="tb-zoom">
          <button type="button" className="tb-icon" data-testid="zoom-out" aria-label="Zoom out" title="Zoom out" onClick={() => setScale(Math.max(0.4, scale - 0.2))}><Icon name="minus" /></button>
          <span className="zoom">{Math.round(scale * 100)}%</span>
          <button type="button" className="tb-icon" data-testid="zoom-in" aria-label="Zoom in" title="Zoom in" onClick={() => setScale(Math.min(3, scale + 0.2))}><Icon name="plus" /></button>
        </div>
        <button type="button" data-testid="download" className="primary" disabled={s.pages.length === 0 || busy}
          onClick={() => exportPages(s.pages, "edited")}><Icon name="download" />{busy ? "Building…" : "Download"}</button>
      </div>
    </header>
  );
}
