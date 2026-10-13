import { useState } from "react";
import { useAiStore } from "../../store/ai";
import Sheet from "./Sheet";
import { useSheets } from "./useGate";

type Interval = "month" | "year";
const PRICE: Record<Interval, { amount: string; per: string }> = { month: { amount: "$29", per: "/ month" }, year: { amount: "$249", per: "/ year" } };

/** Free accounts after the trial: Pro features, Monthly/Yearly toggle, Stripe Checkout. */
export default function PaywallSheet({ navigate = (url: string) => window.location.assign(url) }: { navigate?: (url: string) => void }) {
  const open = useSheets((s) => s.open === "paywall");
  const close = useSheets((s) => s.close);
  const [interval, setInterval] = useState<Interval>("year");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!open) return null;

  const subscribe = async () => {
    setBusy(true); setFailed(false);
    try {
      const client = useAiStore.getState().client;
      if (!client) throw new Error("no client");
      navigate(await client.checkout(interval));
    } catch { setFailed(true); setBusy(false); }
  };
  const price = PRICE[interval];
  return (
    <Sheet title="Go Pro" onClose={close} className="acct-hero">
      <div className="sigBody">
        <p className="acct-lede">Your trial has ended. Pro brings back editing and full AI.</p>
        <div className="sigTabs acct-toggle" role="radiogroup" aria-label="Billing interval">
          <button type="button" role="radio" aria-checked={interval === "month"} className={interval === "month" ? "active" : ""} onClick={() => setInterval("month")}>Monthly</button>
          <button type="button" role="radio" aria-checked={interval === "year"} className={interval === "year" ? "active" : ""} onClick={() => setInterval("year")}>Yearly <span className="acct-save">2 months free</span></button>
        </div>
        <div className="acct-price"><span>{price.amount}</span><small>{price.per}</small></div>
        <ul className="acct-list">
          <li>Edit text, annotate, fill and sign</li>
          <li>1,000 AI requests a month</li>
          <li>120 voice minutes a month</li>
          <li>300 Deep OCR pages a month</li>
        </ul>
        {failed ? <div className="sigError" role="alert">Couldn't start checkout. Try again.</div> : null}
      </div>
      <div className="sigActions acct-stack">
        <button type="button" className="sigPrimary acct-wide" disabled={busy} onClick={() => void subscribe()}>Subscribe</button>
        <span className="acct-note">Secure checkout by Stripe · cancel any time</span>
      </div>
    </Sheet>
  );
}
