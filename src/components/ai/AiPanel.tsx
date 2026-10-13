import { useEffect, useState } from "react";
import { useAiStore } from "../../store/ai";
import { useDocumentStore } from "../../store/document";
import { useAiClient } from "./useAiClient";
import SummarizeTab from "./SummarizeTab";
import AskTab from "./AskTab";
import ExtractTab from "./ExtractTab";
import RewriteTab from "./RewriteTab";
import { useOcrStore } from "../../store/ocr";
import ScopeToggle from "./ScopeToggle";
import { Icon } from "../icons";
import UpgradeProButton from "../account/UpgradeProButton";

/** Time of day when the reset is within a day, otherwise the date (monthly limits). */
const resetLabel = (unix: number) => {
  const d = new Date(unix * 1000);
  return unix - Date.now() / 1000 > 86400 ? d.toLocaleDateString([], { month: "short", day: "numeric" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

type Tab = "summarize" | "ask" | "rewrite" | "extract";

export default function AiPanel() {
  const [tab, setTab] = useState<Tab>("summarize");
  const { noticeDismissed, dismissNotice, remaining, limitedUntil, resetForNewDocument } = useAiStore();
  const ocrEnabled = useOcrStore((s) => s.enabled);
  const setOcrEnabled = useOcrStore((s) => s.setEnabled);
  const sourcesKey = useDocumentStore((s) => [...s.sources.keys()].join(","));

  const configured = useAiClient();

  useEffect(() => { resetForNewDocument(); }, [sourcesKey, resetForNewDocument]);

  if (!configured) return <div className="ai-panel"><p className="muted">AI features are not configured.</p></div>;

  const limited = limitedUntil !== null && limitedUntil > Date.now() / 1000;
  const tabs: Tab[] = ["summarize", "ask", "rewrite", "extract"];
  return (
    <div className="ai-panel">
      <div className="ai-subtabs" role="tablist" aria-label="AI tools">
        {tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} data-testid={`ai-tab-${t}`} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      <div className="ai-settings">
        {tab !== "rewrite" && <ScopeToggle />}
        <label className="ocr-setting"><input type="checkbox" data-testid="ocr-auto" checked={ocrEnabled} onChange={(e) => setOcrEnabled(e.target.checked)} /> Recognize text automatically</label>
      </div>
      {!noticeDismissed && (
        <div className="ai-notice" data-testid="ai-notice">
          <Icon name="lock" size={14} />
          <span>Text from this document is sent to Claude to answer. The PDF file itself never leaves your browser.</span>
          <button onClick={dismissNotice}>Got it</button>
        </div>
      )}
      {tab === "summarize" && <SummarizeTab disabled={limited} />}
      {tab === "ask" && <AskTab disabled={limited} />}
      {tab === "rewrite" && <RewriteTab disabled={limited} />}
      {tab === "extract" && <ExtractTab disabled={limited} />}
      {limited && limitedUntil && (
        <div className="limit-panel" data-testid="ai-limit">
          <p>Limit reached. Resets {resetLabel(limitedUntil)}.</p>
          <UpgradeProButton />
        </div>
      )}
      <div className="ai-footer" data-testid="ai-footer">
        {remaining ? `${remaining.requests} requests left today` : "20 free requests per day"}
        {limited && limitedUntil && ` · resets ${new Date(limitedUntil * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
      </div>
    </div>
  );
}
