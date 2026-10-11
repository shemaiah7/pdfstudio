import { useAiStore } from "../../store/ai";
import Markdown from "./Markdown";

export default function AskTab({ disabled }: { disabled: boolean }) {
  const { chat, setDraft, run } = useAiStore();
  const send = () => { if (chat.draft.trim()) void run("ask"); };
  return (
    <div className="ai-tab">
      <div className="ai-thread" data-testid="ai-result">
        {chat.turns.map((t, i) => (
          <div key={i} className={`turn ${t.role}`}>{t.role === "user" ? <p>{t.text}</p> : <Markdown text={t.text || "…"} />}</div>
        ))}
        {chat.error && <div className="ai-error">{chat.error}</div>}
      </div>
      <div className="ai-row">
        <input value={chat.draft} placeholder="Ask about this document" disabled={disabled}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button data-testid="ai-run" className="primary" disabled={disabled || chat.status === "running" || !chat.draft.trim()} onClick={send}>Send</button>
      </div>
    </div>
  );
}
