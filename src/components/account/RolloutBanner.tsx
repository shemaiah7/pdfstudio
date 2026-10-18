import { useState } from "react";

const KEY = "pdfstudio.rolloutDismissed";
const wasDismissed = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const defaultNotice = (): string => ((import.meta.env.VITE_ROLLOUT_NOTICE as string | undefined) ?? "").trim();

/** One-week heads-up before the paywall phase. `notice` is the launch date text (build var VITE_ROLLOUT_NOTICE). */
export default function RolloutBanner({ notice = defaultNotice() }: { notice?: string }) {
  const [hidden, setHidden] = useState(wasDismissed);
  if (!notice || hidden) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked */ } };
  return (
    <div className="acct-rollout" role="status">
      <span>{`From ${notice}, AI, Voice and editing need a free account. Your first 7 days include everything; viewing PDFs stays free.`}</span>
      <button type="button" className="acct-x" aria-label="Dismiss" onClick={dismiss}>×</button>
    </div>
  );
}
