import { useShallow } from "zustand/react/shallow";
import { useOcrStore } from "../../store/ocr";
import { useDocumentStore } from "../../store/document";
import { useAiStore } from "../../store/ai";
import { Icon } from "../icons";
import { useGate, useLocked } from "../account/useGate";
export default function DeepOcrMenu() {
  const client = useAiStore((s) => s.client);
  const acknowledged = useOcrStore((s) => s.deepOcrAcknowledged);
  const acknowledge = useOcrStore((s) => s.acknowledgeDeepOcr);
  const deepOcr = useOcrStore((s) => s.deepOcr);
  const scanned = useOcrStore(useShallow((s) => { void s.pages; return s.scannedPageEntries(); }));
  const pages = useDocumentStore((s) => s.pages);
  const selection = useDocumentStore((s) => s.selection);
  const scannedSet = new Set(scanned);
  const selected = pages.filter((p) => selection.has(p.id) && scannedSet.has(p.id)).map((p) => p.id);
  const first = selected[0] ?? scanned[0];
  const { require } = useGate();
  const locked = useLocked("deepOcr");
  const run = (target: string[] | "all-scanned") => {
    if (!require("deepOcr")) return;
    const n = target === "all-scanned" ? scanned.length : target.length;
    if (n === 0) return;
    if (!acknowledged) {
      if (!window.confirm(`Deep OCR sends images of ${n} page(s) to the AI service for transcription. Text stays on this device afterwards.`)) return;
      acknowledge();
    }
    void deepOcr(target);
  };
  const disabled = !client || scanned.length === 0;
  return (
    <details className="deep-ocr" data-testid="deep-ocr">
      <summary className={locked ? "locked" : undefined}><Icon name="deep-ocr" />Deep OCR<Icon name="chevron-down" size={14} /></summary>
      <div className="deep-ocr-menu">
        <button disabled={disabled || !first} onClick={() => first && run([first])}>This page</button>
        <button disabled={disabled || selected.length === 0} onClick={() => run(selected)}>Selected pages</button>
        <button disabled={disabled} onClick={() => run("all-scanned")}>All scanned pages</button>
      </div>
    </details>
  );
}
