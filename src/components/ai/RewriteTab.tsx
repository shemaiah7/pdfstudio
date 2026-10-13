import { useMemo } from "react";
import { useAiStore, type RewriteMode } from "../../store/ai";
import { useDocumentStore } from "../../store/document";
import { useGate, useLocked } from "../account/useGate";
import { layoutInBoxes } from "../../pdf/layout";
import { normalizeFont } from "../../pdf/fonts";
import { usePdfMeasure } from "../usePdfMeasure";

const MODES: { value: RewriteMode; label: string }[] = [
  { value: "rewrite", label: "Rewrite" }, { value: "simplify", label: "Simplify" }, { value: "formal", label: "Make formal" },
  { value: "translate", label: "Translate" }, { value: "explain", label: "Explain" },
];

export default function RewriteTab({ disabled }: { disabled: boolean }) {
  const { rewrite, setRewriteMode, setLanguage, setRewriteResult, run, setSelection } = useAiStore();
  const { require } = useGate();
  const locked = useLocked("ai");
  const pages = useDocumentStore((s) => s.pages);
  const addEdit = useDocumentStore((s) => s.addEdit);
  const clearSel = useDocumentStore((s) => s.clearSelection);
  const sel = rewrite.selection;
  const entry = sel ? pages.find((p) => p.id === sel.pageEntryId) : undefined;
  const pageEl = sel ? document.querySelector<HTMLElement>(`#page-${sel.pageEntryId}`) : null;
  const effectiveRotation = entry ? ((Number(pageEl?.dataset.pageRotate ?? 0) + entry.rotation) % 360 + 360) % 360 : 0;
  const font = sel ? (sel.serif ? "serif" : sel.bold ? "sans-bold" : "sans") : "sans";
  const face = normalizeFont(font);
  const measure = usePdfMeasure([face])[face];
  const fit = useMemo(() => (sel && rewrite.result && measure ? layoutInBoxes(rewrite.result, sel.boxes, sel.fontSize, measure) : null), [sel, rewrite.result, face, measure]);
  const canInsert = !!sel && !!entry && !!fit && !fit.overflow && rewrite.mode !== "explain" && effectiveRotation === 0 && rewrite.status === "done";

  const insert = () => {
    if (!sel || !canInsert) return;
    addEdit({ pageEntryId: sel.pageEntryId, boxes: sel.boxes, text: rewrite.result, fontSize: sel.fontSize, font, color: [0, 0, 0] });
    setSelection(null); setRewriteResult(""); clearSel(); window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="ai-tab">
      {!sel ? <p className="muted">Select text on a page to rewrite it.</p> : (
        <blockquote className="ai-selection">{sel.text.length > 300 ? sel.text.slice(0, 300) + "…" : sel.text}</blockquote>
      )}
      <div className="ai-row">
        <select value={rewrite.mode} onChange={(e) => setRewriteMode(e.target.value as RewriteMode)}>{MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        {rewrite.mode === "translate" && <input placeholder="Language" value={rewrite.language} onChange={(e) => setLanguage(e.target.value)} />}
        <button data-testid="ai-run" className={`primary${locked ? " locked" : ""}`} disabled={disabled || !sel || !entry || rewrite.status === "running" || (rewrite.mode === "translate" && !rewrite.language.trim())} onClick={() => { if (require("ai")) void run("rewrite"); }}>
          {rewrite.status === "running" ? "Working…" : "Run"}
        </button>
      </div>
      {rewrite.error && <div className="ai-error">{rewrite.error}</div>}
      {(rewrite.result || rewrite.status === "running") && (
        <div data-testid="ai-result" className="ai-result">
          <textarea value={rewrite.result} rows={6} onChange={(e) => setRewriteResult(e.target.value)} disabled={rewrite.status === "running"} />
          {fit?.overflow && <div className="ai-error">Too long to fit; shorten the text.</div>}
          {effectiveRotation !== 0 && <div className="ai-error">Rotate the page back to its original orientation to insert text.</div>}
          <div className="ai-row">
            <button onClick={() => navigator.clipboard.writeText(rewrite.result)}>Copy</button>
            <button data-testid="ai-insert" className="primary" disabled={!canInsert} onClick={insert}>Insert into PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}
