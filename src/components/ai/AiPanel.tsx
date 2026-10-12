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
      {!noticeDismissed && (
        <div className="ai-notice" data-testid="ai-notice">
          Text from this document is sent to Claude to answer. The PDF file itself never leaves your browser.
          <button onClick={dismissNotice}>Got it</button>
        </div>
      )}
      <label className="ocr-setting"><input type="checkbox" data-testid="ocr-auto" checked={ocrEnabled} onChange={(e) => setOcrEnabled(e.target.checked)} /> Recognize text automatically</label>
      {tab !== "rewrite" && <ScopeToggle />}
      <div className="ai-tabs">
        {tabs.map((t) => <button key={t} data-testid={`ai-tab-${t}`} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === "summarize" && <SummarizeTab disabled={limited} />}
      {tab === "ask" && <AskTab disabled={limited} />}
      {tab === "rewrite" && <RewriteTab disabled={limited} />}
      {tab === "extract" && <ExtractTab disabled={limited} />}
      <div className="ai-footer" data-testid="ai-footer">
        {remaining ? `${remaining.requests} requests left today` : "20 free requests per day"}
        {limited && limitedUntil && ` · resets ${new Date(limitedUntil * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
      </div>
    </div>
  );
}
