import { useEffect, useState } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useAccount } from "../../account/store";
import { useAiStore } from "../../store/ai";
import type { MeResponse } from "../../ai/client";
import Sheet from "./Sheet";
import { initials } from "./initials";
import { useSheets } from "./useGate";

const fmt = new Intl.NumberFormat("en-US");
const dateText = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

interface Bar { label: string; value: string; pct: number }
function bars(me: MeResponse): Bar[] {
  const u = me.usage, l = me.limits;
  if (!u || !l) return [];
  const month = me.plan === "pro" || me.plan === "trial";
  const rows: Bar[] = [];
  const add = (label: string, used: number, cap: number, minutes = false) => {
    if (cap <= 0) return;
    const [a, b] = minutes ? [Math.round(used / 60), Math.round(cap / 60)] : [used, cap];
    rows.push({ label, value: `${fmt.format(a)} / ${fmt.format(b)}`, pct: Math.min(100, (used / cap) * 100) });
  };
  add("AI requests today", u.aiDay, l.aiDay);
  if (month) add("AI requests this month", u.aiMonth, l.aiMonth);
  add("Voice minutes today", u.voiceDaySec, l.voiceDaySec, true);
  if (month) add("Voice minutes this month", u.voiceMonthSec, l.voiceMonthSec, true);
  add("Deep OCR pages this month", u.ocrMonth, l.ocrMonth);
  return rows;
}

function planRow(me: MeResponse): { name: string; detail: string } {
  if (me.plan === "pro") {
    const ends = me.status === "canceled";
    return { name: "Pro", detail: me.periodEnd ? `${ends ? "Ends" : "Renews"} ${dateText(me.periodEnd)}` : "" };
  }
  if (me.plan === "trial") return { name: "Trial", detail: me.trialEndsAt ? `Ends ${dateText(me.trialEndsAt)}` : "" };
  return { name: "Free", detail: "Trial ended" };
}


interface Props { onClose: () => void; navigate?: (url: string) => void; reload?: () => void }

/** Plan, renewal or trial date, usage bars, Manage billing, Sign out and Delete account. Needs ClerkProvider. */
export default function AccountMenu({ onClose, navigate = (url) => window.location.assign(url), reload = () => window.location.reload() }: Props) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const me = useAccount((s) => s.me);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (confirming) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, confirming]);

  const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Your account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const hasBilling = !!me && (me.plan === "pro" || !!me.status);

  const billing = async () => {
    setError(null);
    try {
      const client = useAiStore.getState().client;
      if (!client) throw new Error("no client");
      navigate(await client.portal());
    } catch { setError("Couldn't open billing. Try again."); }
  };
  const del = async () => {
    setBusy(true); setError(null);
    try {
      const client = useAiStore.getState().client;
      if (!client) throw new Error("no client");
      await client.deleteAccount();
    } catch { setError("Couldn't delete your account. Try again."); setBusy(false); return; }
    // The account is gone; if Clerk can't sign out cleanly, a reload drops the dead session.
    useAccount.getState().clear();
    try { await signOut(); } catch { reload(); }
  };

  const plan = me ? planRow(me) : null;
  return (
    <>
      <div className="acct-menu" role="dialog" aria-label="Account">
        <div className="acct-who">
          <span className="acct-avatar" aria-hidden="true">{initials(name)}</span>
          <div className="acct-who-text"><strong>{name}</strong>{email && email !== name ? <span>{email}</span> : null}</div>
        </div>
        {plan ? <div className="acct-plan"><strong>{plan.name}</strong><span>{plan.detail}</span></div> : null}
        {me ? bars(me).map((b) => (
          <div className="acct-usage" key={b.label}>
            <div><span>{b.label}</span><span className="mono">{b.value}</span></div>
            <div className="acct-bar" role="presentation"><div style={{ width: `${b.pct}%` }} /></div>
          </div>
        )) : null}
        {error ? <div className="sigError" role="alert">{error}</div> : null}
        <div className="acct-actions">
          {me && !hasBilling && me.paywall ? <button type="button" onClick={() => { onClose(); useSheets.getState().show("paywall"); }}>Upgrade to Pro</button> : null}
          {hasBilling ? <button type="button" onClick={() => void billing()}>Manage billing</button> : null}
          <button type="button" onClick={() => void signOut()}>Sign out</button>
          <button type="button" className="danger" onClick={() => { setTyped(""); setConfirming(true); }}>Delete account…</button>
        </div>
      </div>
      {confirming ? (
        <Sheet title="Delete your account?" onClose={busy ? undefined : () => setConfirming(false)}>
          <div className="sigBody">
            <p className="acct-lede small">This permanently deletes your account and cancels any subscription. Your PDFs are never stored on our servers, so they are not affected.</p>
            <label className="sigLabel">Type DELETE to confirm
              <input type="text" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
            </label>
            {error ? <div className="sigError" role="alert">{error}</div> : null}
          </div>
          <div className="sigActions acct-split">
            <button type="button" className="sigSecondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="sigPrimary acct-danger" disabled={typed !== "DELETE" || busy} onClick={() => void del()}>Delete my account</button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
