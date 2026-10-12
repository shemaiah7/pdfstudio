// src/components/live/VoiceTab.tsx
import { useLiveStore } from "../../store/live";
import { useDocumentStore } from "../../store/document";

export const DISCLOSURE = "Voice sends your microphone audio to ElevenLabs and the passages of this document needed to answer each question to ElevenLabs and Anthropic. Recordings are not kept. About $0.10 per minute, 30 minutes per day.";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function VoiceTab() {
  const s = useLiveStore();
  const hasDoc = useDocumentStore((d) => d.pages.length > 0);

  const begin = () => {
    if (!useLiveStore.getState().acknowledged) {
      if (!window.confirm(DISCLOSURE)) return;
      s.acknowledge();
    }
    void s.start();
  };

  if (s.status === "live" || s.status === "ending" || s.status === "connecting") {
    return (
      <div className="ai-tab voice-tab">
        <div className="ai-row">
          <span className={`voice-dot ${s.status === "live" ? "on" : ""}`} aria-hidden="true" />
          <span data-testid="voice-status">
            {s.status === "connecting" ? "Connecting…" : s.status === "ending" ? "Ending…" : mmss(s.seconds)}
            {s.remainingSeconds !== null && ` · ${Math.floor(s.remainingSeconds / 60)} min left today`}
          </span>
        </div>
        {s.keywordMode && <p className="muted">Using keyword matching (search model not loaded)</p>}
        <div className="voice-captions" data-testid="voice-captions">
          {s.captions.map((c, i) => <p key={i} className={`caption ${c.role}`}><b>{c.role === "you" ? "You" : "Assistant"}:</b> {c.text}</p>)}
          {s.searching && <p className="muted">Searching the document…</p>}
        </div>
        <div className="ai-row">
          <button data-testid="voice-mute" onClick={() => s.setMuted(!s.muted)} disabled={s.status !== "live"}>{s.muted ? "Unmute" : "Mute"}</button>
          <button data-testid="voice-end" className="primary" onClick={() => void s.end()} disabled={s.status === "ending"}>End</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-tab voice-tab">
      <p className="muted">Talk with an assistant about the open document. It answers only from the document's text and cites pages.</p>
      {s.error && (s.status === "error"
        ? <p className="ai-error" data-testid="voice-error">{s.error}</p>
        : <p className="muted" data-testid="voice-notice">{s.error}</p>)}
      {s.captions.length > 0 && (
        <div className="voice-captions" data-testid="voice-captions">
          {s.captions.map((c, i) => <p key={i} className={`caption ${c.role}`}><b>{c.role === "you" ? "You" : "Assistant"}:</b> {c.text}</p>)}
        </div>
      )}
      <button data-testid="voice-start" className="primary" onClick={begin} disabled={!hasDoc}>{s.status === "error" ? "Retry" : "Start voice session"}</button>
      {!hasDoc && <p className="muted">Open a document first.</p>}
      {s.remainingSeconds !== null && <p className="muted">{Math.floor(s.remainingSeconds / 60)} min left today</p>}
    </div>
  );
}
