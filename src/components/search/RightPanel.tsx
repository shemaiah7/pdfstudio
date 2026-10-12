import { useEffect, useState } from "react";
import { useSearchStore } from "../../store/search";
import AiPanel from "../ai/AiPanel";
import SearchTab from "./SearchTab";
import VoiceTab from "../live/VoiceTab";

export default function RightPanel() {
  const [tab, setTab] = useState<"ai" | "search" | "voice">("ai");
  const init = useSearchStore((st) => st.init);
  useEffect(() => { void init(); }, [init]);
  return (
    <div className="ai-panel">
      <div className="ai-tabs panel-tabs">
        <button data-testid="panel-tab-ai" className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>AI</button>
        <button data-testid="panel-tab-search" className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>Search</button>
        <button data-testid="panel-tab-voice" className={tab === "voice" ? "active" : ""} onClick={() => setTab("voice")}>Voice</button>
      </div>
      {tab === "ai" ? <AiPanel /> : tab === "search" ? <SearchTab /> : <VoiceTab />}
    </div>
  );
}
