import { clerkEnabled } from "../../account/clerk";
import { Icon } from "../icons";
import Sheet from "./Sheet";
import SignInTrigger from "./SignInTrigger";
import { useSheets } from "./useGate";

/** Anonymous visitors who reach an editing or AI feature. */
export default function UpgradeSheet() {
  const open = useSheets((s) => s.open === "upgrade");
  const close = useSheets((s) => s.close);
  if (!open) return null;
  const clerk = clerkEnabled();
  return (
    <Sheet title="Create a free account to edit and use AI" onClose={close} className="acct-hero">
      <div className="sigBody">
        <span className="acct-badge" aria-hidden="true"><Icon name="highlight" size={22} /></span>
        <p className="acct-lede">7 days of full access, no card needed. Viewing PDFs stays free without an account.</p>
        <ul className="acct-list">
          <li>Edit text, annotate, fill and sign</li>
          <li>Ask, Summarize, Voice and Deep OCR</li>
          <li>Your PDFs still stay in your browser</li>
        </ul>
      </div>
      {clerk ? (
        <div className="sigActions acct-stack">
          <SignInTrigger mode="sign-up" onBeforeOpen={close}><button type="button" className="sigPrimary acct-wide" onClick={close}>Create account</button></SignInTrigger>
          <SignInTrigger mode="sign-in" onBeforeOpen={close}><button type="button" className="acct-link" onClick={close}>I already have an account · Sign in</button></SignInTrigger>
        </div>
      ) : null}
    </Sheet>
  );
}
