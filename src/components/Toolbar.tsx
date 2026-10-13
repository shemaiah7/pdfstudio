import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import ThemeToggle from "./ThemeToggle";
import InstallButton from "./InstallButton";
import { useInstallStore } from "../pwa/install";
import { outputName, saveBlob } from "../pdf/download";

interface Props { scale: number; setScale: (s: number) => void; onFiles: (files: File[], mode: "open" | "add") => void; onTogglePages: () => void; pagesOpen: boolean }

const PHONE_QUERY = "(max-width: 700px)";
const subscribePhone = (cb: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isPhone = () => typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;

export default function Toolbar({ scale, setScale, onFiles, onTogglePages, pagesOpen }: Props) {
  const s = useDocumentStore();
  const [busy, setBusy] = useState(false);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const [moreOpen, setMoreOpen] = useState(false);
  const installHint = useInstallStore((st) => st.platformHint);
  const actionsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (actionsRef.current?.contains(t) || moreRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [moreOpen]);

  const pick = (ref: React.RefObject<HTMLInputElement | null>, mode: "open" | "add") => (
    <input ref={ref} type="file" accept="application/pdf" multiple hidden
      onChange={(e) => { onFiles(Array.from(e.target.files ?? []), mode); e.target.value = ""; }} />
  );

  const ib = (testid: string, icon: IconName, label: string, onClick: () => void, disabled = false, title = label) => (
    <button type="button" className="tb-icon" data-testid={testid} aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );

  const zoom = (
    <div className="tb-zoom">
      <button type="button" className="tb-icon" data-testid="zoom-out" aria-label="Zoom out" title="Zoom out" onClick={() => setScale(Math.max(0.4, scale - 0.2))}><Icon name="minus" /></button>
      <span className="zoom">{Math.round(scale * 100)}%</span>
      <button type="button" className="tb-icon" data-testid="zoom-in" aria-label="Zoom in" title="Zoom in" onClick={() => setScale(Math.min(3, scale + 0.2))}><Icon name="plus" /></button>
    </div>
  );

  return (
    <header className="toolbar">
      <button type="button" className="tb-icon tb-pages" aria-label="Pages" title="Pages" aria-expanded={pagesOpen} onClick={onTogglePages}><Icon name="grid" /></button>
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
      <div className={`tb-actions${moreOpen ? " open" : ""}`} ref={actionsRef}>
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
      {phone ? null : <OcrPill />}
      {phone ? zoom : null}
      {phone ? <InstallButton className="tb-icon" iconOnly /> : null}
      {phone ? <ThemeToggle className="tb-icon" /> : null}
      </div>
      <div className="tb-right">
        <button type="button" className="tb-icon tb-more" aria-label="More actions" title="More actions" aria-expanded={moreOpen} ref={moreRef} onClick={() => setMoreOpen((o) => !o)}><Icon name="dots" /></button>
        {phone ? null : <div className="tb-group">{installHint === "prompt" ? <InstallButton className="tb-icon" iconOnly /> : null}<ThemeToggle className="tb-icon" /></div>}
        {phone ? null : zoom}
        <button type="button" data-testid="download" className="primary" disabled={s.pages.length === 0 || busy}
          onClick={() => exportPages(s.pages, "edited")}><Icon name="download" /><span className="tb-dl-label">{busy ? "Building…" : "Download"}</span></button>
      </div>
      {/* On phones the actions live in the More menu; keep OCR progress visible under the bar instead. */}
      {phone ? <OcrPill /> : null}
    </header>
  );
}
