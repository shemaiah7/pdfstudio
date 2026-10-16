import { useState, type ReactNode } from "react";
import { SignIn, useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { appLink, fetchDesktopTicket, stateFromSearch } from "./desktopTicket";

const INVALID = "This sign-in link isn't valid. Start again from the SentinelPDF app.";
const UNAVAILABLE = "Sign-in isn't available right now. You can keep viewing PDFs.";
const RATE = "Too many tries. Wait a minute and try again.";

const base = (): string => import.meta.env.VITE_AI_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");
const go = (u: string) => { window.location.href = u; };

export function DesktopSignInShell({ children }: { children?: ReactNode }) {
  return (
    <main className="dsp">
      <header className="dsp-head">
        <a className="dsp-brand" href="/"><img src="/brand/mark-small.svg" alt="" width="30" height="30" />SentinelPDF</a>
      </header>
      <div className="dsp-body">{children}</div>
    </main>
  );
}

/** Static page for builds without accounts. */
export function DesktopSignInUnavailable() {
  return <DesktopSignInShell><p className="dsp-msg">{UNAVAILABLE}</p></DesktopSignInShell>;
}

export default function DesktopSignInPage({ navigate = go }: { navigate?: (url: string) => void }) {
  const state = stateFromSearch(window.location.search);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  if (state === null) return <DesktopSignInShell><p className="dsp-msg">{INVALID}</p></DesktopSignInShell>;
  if (!isLoaded) return <DesktopSignInShell />;
  if (!isSignedIn) {
    return <DesktopSignInShell><SignIn routing="hash" forceRedirectUrl={window.location.href} /></DesktopSignInShell>;
  }

  async function onContinue() {
    if (busy || state === null) return;
    setBusy(true); setError(null);
    try {
      const jwt = await getToken();
      const r = await fetchDesktopTicket(base(), jwt ?? "");
      if ("ticket" in r) {
        const url = appLink(r.ticket, state);
        setLink(url);
        navigate(url);
      } else {
        setError(r.error === "rate_limited" ? RATE : UNAVAILABLE);
      }
    } catch {
      setError(UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }

  if (link) {
    return (
      <DesktopSignInShell>
        <div className="dsp-card">
          <p className="dsp-msg">You're signed in. Return to SentinelPDF.</p>
          <button type="button" className="dsp-primary" onClick={() => navigate(link)}>Return to SentinelPDF</button>
        </div>
      </DesktopSignInShell>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  return (
    <DesktopSignInShell>
      <div className="dsp-card">
        <p className="dsp-msg">Sign in to the SentinelPDF app as <strong>{email}</strong></p>
        <button type="button" className="dsp-primary" disabled={busy} onClick={() => void onContinue()}>Continue</button>
        {error && <p className="dsp-error" role="alert">{error}</p>}
        <button type="button" className="dsp-link" onClick={() => void signOut({ redirectUrl: window.location.href })}>Not you? Switch account</button>
      </div>
    </DesktopSignInShell>
  );
}
