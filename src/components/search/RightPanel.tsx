import { useState } from "react";
import AiPanel from "../ai/AiPanel";
import SearchTab from "./SearchTab";

export default function RightPanel() {
  const [tab, setTab] = useState<"ai" | "search">("ai");
  return (
    <div className="ai-panel">
      <div className="ai-tabs panel-tabs">
        <button data-testid="panel-tab-ai" className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>AI</button>
        <button data-testid="panel-tab-search" className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>Search</button>
      </div>
      {tab === "ai" ? <AiPanel /> : <SearchTab />}
    </div>
  );
}
