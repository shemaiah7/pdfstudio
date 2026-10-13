import { useEffect, useState } from "react";
import { useAccount } from "../../account/store";

const POLL_MS = 3000, MAX_POLLS = 10, TOAST_MS = 4000;
type Phase = "idle" | "activating" | "active" | "slow";

function dropCheckoutParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("checkout");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/** Back from Stripe Checkout: re-check /me every 3 s for up to 30 s until the webhook has made the user Pro. */
export default function ActivatingNotice() {
  const [phase, setPhase] = useState<Phase>("idle");
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("checkout");
    if (flag !== "success") { if (flag) dropCheckoutParam(); return; }
    setPhase("activating");
    let polls = 0, stopped = false;
    const timer = window.setInterval(async () => {
      polls++;
      await useAccount.getState().refresh();
      if (stopped) return;
      if (useAccount.getState().plan() === "pro") { finish("active"); }
      else if (polls >= MAX_POLLS) finish("slow");
    }, POLL_MS);
    function finish(next: Phase) {
      stopped = true;
      window.clearInterval(timer);
      dropCheckoutParam();
      setPhase(next);
    }
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (phase !== "active") return;
    const t = window.setTimeout(() => setPhase("idle"), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;
  if (phase === "active") return <div className="acct-toast ok" role="status">Pro is active</div>;
  if (phase === "slow") {
    return (
      <div className="acct-toast" role="status">
        <span>Payment received — Pro will appear shortly. Refresh in a minute.</span>
        <button type="button" className="acct-x" aria-label="Dismiss" onClick={() => setPhase("idle")}>×</button>
      </div>
    );
  }
  return <div className="acct-toast" role="status"><span className="acct-spin" aria-hidden="true" />Activating Pro…</div>;
}
