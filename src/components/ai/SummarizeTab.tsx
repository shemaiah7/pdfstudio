import { useAiStore } from "../../store/ai";
import { useDocumentStore } from "../../store/document";
import Markdown from "./Markdown";

export default function SummarizeTab({ disabled }: { disabled: boolean }) {
  const { summary, setSummaryScope, run } = useAiStore();
  const hasSelection = useDocumentStore((s) => s.selection.size > 0);
  return (
    <div className="ai-tab">
      <div className="ai-row">
        <label><input type="radio" checked={summary.scope === "all"} onChange={() => setSummaryScope("all")} /> Whole document</label>
        <label><input type="radio" checked={summary.scope === "selected"} disabled={!hasSelection} onChange={() => setSummaryScope("selected")} /> Selected pages</label>
      </div>
      <button data-testid="ai-run" className="primary" disabled={disabled || summary.status === "running"} onClick={() => run("summarize")}>
        {summary.status === "running" ? "Summarizing…" : "Summarize"}
      </button>
      {summary.error && <div className="ai-error">{summary.error}</div>}
      {summary.text && (
        <div data-testid="ai-result" className="ai-result">
          <Markdown text={summary.text} />
          <button onClick={() => navigator.clipboard.writeText(summary.text)}>Copy</button>
        </div>
      )}
    </div>
  );
}
