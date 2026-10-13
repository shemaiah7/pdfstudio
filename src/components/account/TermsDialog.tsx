import { useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import { useAccount } from "../../account/store";
import { useAiStore } from "../../store/ai";
import { clerkEnabled } from "../../account/clerk";
import { TERMS_CHECKBOX, TERMS_URL, TERMS_VERSION } from "../../account/terms";
import Sheet from "./Sheet";

function SignOutLink() {
  const { signOut } = useClerk();
  return <button type="button" className="acct-link" onClick={() => void signOut()}>Sign out</button>;
}

/** Required step for new users and on a terms-version change. Only Sign out leaves it. */
export default function TermsDialog({ signedIn }: { signedIn: boolean }) {
  const me = useAccount((s) => s.me);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!signedIn || !me || !me.paywall || me.termsAccepted !== false) return null;

  const accept = async () => {
    const client = useAiStore.getState().client;
    if (!client) { setFailed(true); return; }
    setBusy(true); setFailed(false);
    try {
      await client.acceptTerms(TERMS_VERSION);
      await useAccount.getState().refresh();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title="Before you start">
      <div className="sigBody">
        <p className="acct-lede small">PDF Studio edits PDFs in your browser. AI and Voice send the text you ask about to Anthropic and ElevenLabs. <a href={TERMS_URL} target="_blank" rel="noreferrer">Read the full terms</a></p>
        <label className="acct-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {TERMS_CHECKBOX}
        </label>
        {failed ? <div className="sigError" role="alert">Couldn't save that. Try again.</div> : null}
      </div>
      <div className="sigActions acct-split">
        {clerkEnabled() ? <SignOutLink /> : <span />}
        <button type="button" className="sigPrimary" disabled={!agreed || busy} onClick={() => void accept()}>Continue</button>
      </div>
    </Sheet>
  );
}
