import { useEffect, useState } from "react";
import { useSearchStore } from "../../store/search";
import AiPanel from "../ai/AiPanel";
import SearchTab from "./SearchTab";
import VoiceTab from "../live/VoiceTab";
import { useLiveStore } from "../../store/live";
import { useAiClient } from "../ai/useAiClient";

export default function RightPanel() {
  const [tab, setTab] = useState<"ai" | "search" | "voice">("voice");
  const [sheet, setSheet] = useState<"peek" | "open">("peek");
  useAiClient();
  const init = useSearchStore((st) => st.init);
  const liveStatus = useLiveStore((s) => s.status);
  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    if (sheet !== "open") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet("peek"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);
  const pickTab = (t: "ai" | "search" | "voice") => () => { setTab(t); setSheet("open"); };
  return (
    <aside className={`rightpanel sheet-${sheet}`}>
    <button type="button" className="sheet-handle" aria-label={sheet === "open" ? "Collapse assistant" : "Expand assistant"} aria-expanded={sheet === "open"} onClick={() => setSheet(sheet === "open" ? "peek" : "open")}><span /></button>
    <div className="ai-panel">
      <div className="panel-tabs" role="tablist" aria-label="Panel">
        <button role="tab" aria-selected={tab === "ai"} data-testid="panel-tab-ai" className={tab === "ai" ? "active" : ""} onClick={pickTab("ai")}>AI</button>
        <button role="tab" aria-selected={tab === "search"} data-testid="panel-tab-search" className={tab === "search" ? "active" : ""} onClick={pickTab("search")}>Search</button>
        <button role="tab" aria-selected={tab === "voice"} data-testid="panel-tab-voice" className={tab === "voice" ? "active" : ""} onClick={pickTab("voice")}>
          Voice
          {liveStatus === "connecting" || liveStatus === "live" ? <span className="voice-dot on" data-testid="voice-tab-live" aria-label="Voice session active" /> : null}
        </button>
      </div>
      {tab === "ai" ? <AiPanel /> : tab === "search" ? <SearchTab /> : <VoiceTab />}
    </div>
    </aside>
  );
}
