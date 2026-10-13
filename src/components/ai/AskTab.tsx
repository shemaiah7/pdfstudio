import { useAiStore } from "../../store/ai";
import { useSearchStore } from "../../store/search";
import { Icon } from "../icons";
import { useGate, useLocked } from "../account/useGate";
import Markdown from "./Markdown";

export default function AskTab({ disabled }: { disabled: boolean }) {
  const { chat, setDraft, run, useSearch, setUseSearch } = useAiStore();
  const { require } = useGate();
  const locked = useLocked("ai");
  const status = useSearchStore((s) => s.model.status);
  const send = () => { if (chat.draft.trim() && require("ai")) void run("ask"); };
  return (
    <div className="ai-tab">
      {status === "ready" && (
        <label className="ai-row muted"><input type="checkbox" data-testid="ask-use-search" checked={useSearch} onChange={(e) => setUseSearch(e.target.checked)} /> Use search</label>
      )}
      {typeof chat.passages === "number" && <p className="muted" data-testid="ask-passages">Answering from {chat.passages} passages</p>}
      <div className="ai-thread" data-testid="ai-result">
        {chat.turns.map((t, i) => (
          <div key={i} className={`turn ${t.role}`}>{t.role === "user" ? <p>{t.text}</p> : <Markdown text={t.text || "…"} />}</div>
        ))}
        {chat.error && <div className="ai-error">{chat.error}</div>}
      </div>
      <div className="ai-row ask-input">
        <input value={chat.draft} placeholder="Ask about this document" disabled={disabled}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }} />
        <button data-testid="ai-run" className={`primary${locked ? " locked" : ""}`} disabled={disabled || chat.status === "running" || !chat.draft.trim()} aria-label="Send" title="Send" onClick={send}><Icon name="send" size={18} /></button>
      </div>
    </div>
  );
}
