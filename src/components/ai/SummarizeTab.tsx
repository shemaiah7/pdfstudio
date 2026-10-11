import { useAiStore } from "../../store/ai";
import Markdown from "./Markdown";

export default function SummarizeTab({ disabled }: { disabled: boolean }) {
  const { summary, run } = useAiStore();
  return (
    <div className="ai-tab">
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
