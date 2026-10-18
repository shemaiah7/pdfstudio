import { useState, type ReactNode } from "react";
import { SignIn, useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { appLink, fetchDesktopTicket, stateFromSearch } from "./desktopTicket";

const INVALID = "This sign-in link isn't valid. Start again from the SentinelPDF app.";
const UNAVAILABLE = "Sign-in isn't available right now. You can keep viewing PDFs.";
const RATE = "Too many tries. Wait a minute and try again.";

const base = (): string => import.meta.env.VITE_AI_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");
const go = (u: string) => { window.location.href = u; };

const STEPS = ["Sign in", "Confirm", "Back to the app"];

function Steps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="dsp-steps" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const cls = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={label} className={`dsp-step ${cls}`} aria-current={n === current ? "step" : undefined}>
            <span className="dsp-dot" aria-hidden="true">
              {n < current ? (
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
              ) : n}
            </span>
            <span className="dsp-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Handoff() {
  return (
    <svg className="dsp-handoff" viewBox="0 0 200 40" width="200" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="6" y="7" width="52" height="26" rx="4" />
      <path d="M6 14h52" />
      <circle cx="12" cy="10.5" r="0.8" fill="currentColor" />
      <circle cx="16" cy="10.5" r="0.8" fill="currentColor" />
      <path d="M72 20h50" strokeDasharray="4 4" />
      <path d="M117 15l6 5-6 5" />
      <rect x="140" y="7" width="54" height="22" rx="3" />
      <path d="M160 29v5M174 29v5M155 34h24" />
    </svg>
  );
}

export function DesktopSignInShell({ children, step }: { children?: ReactNode; step?: 1 | 2 | 3 }) {
  return (
    <main className="dsp">
      <header className="dsp-head">
        <a className="dsp-brand" href="/"><img src="/brand/mark-small.svg" alt="" width="30" height="30" />SentinelPDF</a>
      </header>
      <div className="dsp-body">
        <div className="dsp-hero">
          <img className="dsp-mark" src="/brand/mark.svg" alt="" width="64" height="64" />
          <Handoff />
          <h1 className="dsp-title">Sign in to the SentinelPDF desktop app</h1>
        </div>
        {step && <Steps current={step} />}
        {children}
        <p className="dsp-trust">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>
          <span>This one-time pass works only for the app that asked for it and expires in 5 minutes.</span>
        </p>
      </div>
      <footer className="dsp-footer">
        <span>© SentinelPDF · Melantech LLC</span>
        <nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
      </footer>
    </main>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="dsp-card">
      <span className="dsp-icon neutral" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5M10 6.2v.1" /></svg>
      </span>
      <p className="dsp-msg">{text}</p>
    </div>
  );
}

function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (email.trim()[0] ?? "?").toUpperCase();
}

/** Static page for builds without accounts. */
export function DesktopSignInUnavailable() {
  return <DesktopSignInShell><Notice text={UNAVAILABLE} /></DesktopSignInShell>;
}

export default function DesktopSignInPage({ navigate = go }: { navigate?: (url: string) => void }) {
  const state = stateFromSearch(window.location.search);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  if (state === null) return <DesktopSignInShell><Notice text={INVALID} /></DesktopSignInShell>;
  if (!isLoaded) return <DesktopSignInShell />;
  if (!isSignedIn) {
    return <DesktopSignInShell step={1}><div className="dsp-clerk"><SignIn routing="hash" withSignUp forceRedirectUrl={window.location.href} signUpForceRedirectUrl={window.location.href} /></div></DesktopSignInShell>;
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
      <DesktopSignInShell step={3}>
        <div className="dsp-card">
          <span className="dsp-icon ok" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8.5" /></svg>
          </span>
          <h2 className="dsp-card-title">You're signed in to the app</h2>
          <p className="dsp-msg">You can close this tab.</p>
          <p className="dsp-sub">If SentinelPDF didn't open, use the button below.</p>
          <button type="button" className="dsp-primary" onClick={() => navigate(link)}>Open SentinelPDF</button>
        </div>
      </DesktopSignInShell>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const name = (user?.fullName ?? "").trim();
  return (
    <DesktopSignInShell step={2}>
      <div className="dsp-card">
        <div className="dsp-account">
          {user?.imageUrl
            ? <img className="dsp-avatar" src={user.imageUrl} alt="" width="48" height="48" />
            : <span className="dsp-avatar dsp-initials" aria-hidden="true">{initialsOf(name, email)}</span>}
          <div className="dsp-who">
            {name && <div className="dsp-name">{name}</div>}
            <div className="dsp-email">{email}</div>
          </div>
        </div>
        <button type="button" className="dsp-primary" disabled={busy} onClick={() => void onContinue()}>{busy ? "Opening the app…" : "Continue to the app"}</button>
        {error && <p className="dsp-error" role="alert">{error}</p>}
        <button type="button" className="dsp-link" onClick={() => void signOut({ redirectUrl: window.location.href })}>Not you? Switch account</button>
      </div>
    </DesktopSignInShell>
  );
}
