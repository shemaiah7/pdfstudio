import { useEffect, useState } from "react";
import { useAiStore } from "../../store/ai";
import { useDocumentStore } from "../../store/document";
import { AiClient } from "../../ai/client";
import { getTurnstileToken } from "../../ai/turnstile";
import SummarizeTab from "./SummarizeTab";
import AskTab from "./AskTab";
import ExtractTab from "./ExtractTab";
import RewriteTab from "./RewriteTab";

type Tab = "summarize" | "ask" | "rewrite" | "extract";

export default function AiPanel() {
  const [tab, setTab] = useState<Tab>("summarize");
  const { client, setClient, noticeDismissed, dismissNotice, remaining, limitedUntil, resetForNewDocument } = useAiStore();
  const sourcesKey = useDocumentStore((s) => [...s.sources.keys()].join(","));

  useEffect(() => {
    if (client) return;
    const baseUrl = import.meta.env.VITE_AI_URL ?? "http://localhost:8787";
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
    setClient(new AiClient({ baseUrl, getTurnstileToken: () => getTurnstileToken(siteKey) }));
  }, [client, setClient]);

  useEffect(() => { resetForNewDocument(); }, [sourcesKey, resetForNewDocument]);

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
