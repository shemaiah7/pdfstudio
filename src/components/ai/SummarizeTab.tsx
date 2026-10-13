import { useAiStore } from "../../store/ai";
import { useGate, useLocked } from "../account/useGate";
import Markdown from "./Markdown";

export default function SummarizeTab({ disabled }: { disabled: boolean }) {
  const { summary, run } = useAiStore();
  const { require } = useGate();
  const locked = useLocked("ai");
  return (
    <div className="ai-tab">
      <button data-testid="ai-run" className={`primary${locked ? " locked" : ""}`} disabled={disabled || summary.status === "running"} onClick={() => { if (require("ai")) void run("summarize"); }}>
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
