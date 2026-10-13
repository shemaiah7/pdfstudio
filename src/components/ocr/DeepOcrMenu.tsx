import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOcrStore } from "../../store/ocr";
import { useDocumentStore } from "../../store/document";
import { useAiStore } from "../../store/ai";
import { Icon } from "../icons";
import { currentPageId } from "../pageInView";
export default function DeepOcrMenu() {
  const client = useAiStore((s) => s.client);
  const acknowledged = useOcrStore((s) => s.deepOcrAcknowledged);
  const acknowledge = useOcrStore((s) => s.acknowledgeDeepOcr);
  const deepOcr = useOcrStore((s) => s.deepOcr);
  const pagesWithText = useOcrStore((s) => s.pagesWithText);
  const scanned = useOcrStore(useShallow((s) => { void s.pages; return s.scannedPageEntries(); }));
  const pages = useDocumentStore((s) => s.pages);
  const selection = useDocumentStore((s) => s.selection);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(() => currentPageId());
  // The page in view changes as the reader scrolls; keep the label current while the menu is open.
  useEffect(() => {
    setViewId(currentPageId());
    if (!open) return;
    const root = document.querySelector(".pageview");
    const update = () => setViewId(currentPageId());
    root?.addEventListener("scroll", update, { passive: true });
    return () => root?.removeEventListener("scroll", update);
  }, [open, pages]);
  const selected = pages.filter((p) => selection.has(p.id)).map((p) => p.id);
  const thisPage = (): string | null => {
    const id = selected.length === 1 ? selected[0] : currentPageId();
    return id && pages.some((p) => p.id === id) ? id : null;
  };
  const shownId = selected.length === 1 ? selected[0] : viewId;
  const shownIndex = shownId ? pages.findIndex((p) => p.id === shownId) : -1;
  const numbers = (ids: string[]) => ids.map((id) => pages.findIndex((p) => p.id === id) + 1).sort((a, b) => a - b);
  const run = async (target: string[] | "all-scanned") => {
    const ids = target === "all-scanned" ? scanned : target;
    if (ids.length === 0) { useOcrStore.setState({ toast: "No page to read." }); return; }
    if (!acknowledged) {
      if (!window.confirm(`Deep OCR sends images of ${ids.length} page(s) to the AI service for transcription. Text stays on this device afterwards.`)) return;
      acknowledge();
    }
    let allowText = false;
    // Scanned pages never have typed text; only explicit targets can.
    const typed = target === "all-scanned" ? [] : await pagesWithText(ids);
    if (typed.length) {
      const nums = numbers(typed);
      allowText = window.confirm(nums.length === 1
        ? `Page ${nums[0]} already has typed text. Send an image of it to read handwriting too?`
        : `Pages ${nums.join(", ")} already have typed text. Send an image of them to read handwriting too?`);
    }
    void deepOcr(target, { allowText });
  };
  const disabled = !client;
  return (
    <details className="deep-ocr" data-testid="deep-ocr" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary title={disabled ? "Deep OCR needs the AI service." : undefined}><Icon name="deep-ocr" />Deep OCR<Icon name="chevron-down" size={14} /></summary>
      <div className="deep-ocr-menu">
        <button disabled={disabled || pages.length === 0} onClick={() => { const id = thisPage(); void run(id ? [id] : []); }}>
          This page{shownIndex >= 0 && <span className="deep-ocr-page"> · p. {shownIndex + 1}</span>}
        </button>
        <button disabled={disabled} onClick={() => void run(selected)}>Selected pages</button>
        <button disabled={disabled} onClick={() => void run("all-scanned")}>All scanned pages</button>
      </div>
    </details>
  );
}
