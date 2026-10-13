// src/components/live/VoiceTab.tsx
import { useLiveStore } from "../../store/live";
import { useDocumentStore } from "../../store/document";
import { Icon } from "../icons";

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

  const captions = (
    s.captions.map((c, i) => (
      <p key={i} className={`caption ${c.role}`}>
        {c.role === "assistant" && <span className="caption-avatar" aria-hidden="true"><Icon name="voice" size={14} /></span>}
        <span className="caption-text"><b className="sr-only">{c.role === "you" ? "You" : "Assistant"}:</b> {c.text}</span>
      </p>
    ))
  );
  const disclosure = (
    <div className="voice-disclosure"><Icon name="lock" size={14} /><span>{DISCLOSURE}</span></div>
  );
  const mic = (
    <div className="voice-mic">
      <label htmlFor="voice-mic-select">Microphone</label>
      <select id="voice-mic-select" data-testid="voice-mic" value={s.micId ?? ""} onChange={(e) => s.setMic(e.target.value || null)}>
        <option value="">System default</option>
        {s.mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
      </select>
      {s.mics.length === 0 && <p className="voice-mic-hint">Allow the microphone once to see your devices.</p>}
    </div>
  );
  const meter = !s.unlimited && s.remainingSeconds !== null && (
    <div className="voice-meter" aria-hidden="true"><div className="voice-meter-fill" style={{ width: `${Math.min(100, Math.max(0, (s.remainingSeconds / 1800) * 100))}%` }} /></div>
  );

  if (s.status === "live" || s.status === "ending" || s.status === "connecting") {
    const connecting = s.status === "connecting";
    const orbState = connecting ? "connecting" : s.muted ? "muted" : s.searching ? "searching" : "live";
    const title = connecting ? "Starting" : s.muted ? "Microphone off" : s.searching ? "Looking it up" : "Listening";
    return (
      <div className="voice-tab voice-live">
        <div className="voice-header">
          <span className={`voice-label ${connecting ? "pending" : ""}`}><span className={`voice-dot ${connecting ? "" : "on"}`} aria-hidden="true" />{connecting ? "Starting" : "Live"}</span>
          <span className="voice-status" data-testid="voice-status">
            {s.status === "connecting" ? "Connecting…" : s.status === "ending" ? "Ending…" : mmss(s.seconds)}
            {s.unlimited ? " · Owner · unlimited" : s.remainingSeconds !== null && ` · ${Math.floor(s.remainingSeconds / 60)} min left today`}
          </span>
        </div>
        {meter}
        <div className="voice-hero">
          <div className={`voice-orb ${orbState}`}>
            <div className="voice-core">
              {orbState === "muted" ? <Icon name="mic-off" size={30} /> : orbState === "searching" ? <Icon name="search" size={30} /> : (
                <div className="voice-bars" aria-hidden="true">
                  {(connecting ? [14, 14, 14, 14, 14] : [14, 26, 40, 54, 36, 22, 12]).map((h, i) => <span key={i} className="voice-bar" style={{ height: h, animationDelay: `${i * 0.12}s` }} />)}
                </div>
              )}
            </div>
          </div>
          <h3 className="voice-title">{title}</h3>
          {s.keywordMode && <p className="voice-note">Using keyword matching (search model not loaded)</p>}
        </div>
        <div className="voice-captions" data-testid="voice-captions">
          {captions}
          {s.searching && <p className="muted">Searching the document…</p>}
        </div>
        {mic}
        <div className="voice-controls">
          <button data-testid="voice-mute" className="voice-secondary" onClick={() => s.setMuted(!s.muted)} disabled={s.status !== "live"}><Icon name={s.muted ? "mic-off" : "mic"} size={18} />{s.muted ? "Unmute" : "Mute"}</button>
          <button data-testid="voice-end" className="voice-end" onClick={() => void s.end()} disabled={s.status === "ending"}>End</button>
        </div>
        {disclosure}
      </div>
    );
  }

  const isError = s.status === "error";
  return (
    <div className="voice-tab voice-idle">
      <div className="voice-hero">
        <div className={`voice-orb ${isError ? "error" : "idle"}`}>
          <div className="voice-core"><Icon name={isError ? "alert" : "mic"} size={30} /></div>
        </div>
        <h3 className="voice-title">Talk to this document</h3>
        <p className="muted voice-intro">Talk with an assistant about the open document. It answers only from the document's text and cites pages.</p>
      </div>
      <div className="voice-body">
        {s.error && (isError
          ? <p className="ai-error" data-testid="voice-error">{s.error}</p>
          : <p className="muted" data-testid="voice-notice">{s.error}</p>)}
        {s.captions.length > 0 && (
          <div className="voice-captions" data-testid="voice-captions">{captions}</div>
        )}
        <button data-testid="voice-start" className="voice-start" onClick={begin} disabled={!hasDoc}><Icon name="mic" size={18} />{isError ? "Retry" : "Start voice session"}</button>
        {mic}
        {!hasDoc && <p className="muted voice-hint">Open a document first.</p>}
        {s.unlimited ? <p className="muted voice-min">Owner · unlimited</p> : s.remainingSeconds !== null && <><p className="muted voice-min">{Math.floor(s.remainingSeconds / 60)} min left today</p>{meter}</>}
      </div>
      {disclosure}
    </div>
  );
}
