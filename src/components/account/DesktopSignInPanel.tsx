import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth, useSignIn, useSignUp } from "@clerk/clerk-react";
import { canBrowserSignIn, desktopBridge, isDesktop } from "../../desktop/bridge";
import { useDesktopSignIn } from "../../account/desktopSignIn";
import Sheet from "./Sheet";

const NO_FINISH = "Sign-in didn't finish. Try again.";
const UNAVAILABLE = "Sign-in isn't available right now. You can keep viewing PDFs.";
const BAD_CODE = "That code isn't right. Check the email or resend.";
const errCode = (e: unknown) => (e as { errors?: { code?: string }[] } | null)?.errors?.[0]?.code;

/** Mounted once at the root: signs in with the ticket the desktop app hands over, even while the panel is closed. Never logs the ticket. */
export function DesktopTicketListener(): null {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isSignedIn } = useAuth();
  const pending = useRef<string | null>(null);
  const signedIn = useRef(!!isSignedIn);
  signedIn.current = !!isSignedIn;
  const [tick, setTick] = useState(0);
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    const bridge = desktopBridge();
    const offTicket = bridge?.onSignInTicket?.((t) => { pending.current = t; setTick((n) => n + 1); });
    const offFailed = bridge?.onSignInFailed?.(() => {
      if (signedIn.current) return;
      const s = useDesktopSignIn.getState();
      if (!s.open) s.openPanel();
      s.setStep("choose");
      s.setError("That sign-in link expired. Try again.");
    });
    return () => { offTicket?.(); offFailed?.(); };
  }, [desktop]);

  useEffect(() => {
    if (!desktop || !isLoaded || !pending.current) return;
    const ticket = pending.current;
    pending.current = null; // single use
    void (async () => {
      try {
        const r = await signIn.create({ strategy: "ticket", ticket });
        if (r.status !== "complete") throw new Error("incomplete");
        await setActive({ session: r.createdSessionId });
        useDesktopSignIn.getState().close();
      } catch {
        const s = useDesktopSignIn.getState();
        s.openPanel(); s.setStep("choose"); s.setError(NO_FINISH);
      }
    })();
  }, [desktop, isLoaded, tick, signIn, setActive]);

  return null;
}

export default function DesktopSignInPanel() {
  const open = useDesktopSignIn((s) => s.open);
  if (!isDesktop() || !open) return null;
  return <PanelBody />;
}

function PanelBody() {
  const { step, error, close, setStep, setError } = useDesktopSignIn();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [resendWait, setResendWait] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (!canBrowserSignIn()) setStep("email"); }, [setStep]);
  useEffect(() => {
    if (isLoaded) return;
    const t = setTimeout(() => setStep("unavailable"), 10_000);
    return () => clearTimeout(t);
  }, [isLoaded, setStep]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const startWait = useCallback(() => {
    setResendWait(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResendWait(false), 30_000);
  }, []);

  const sendCode = async (addr: string, m: "signIn" | "signUp") => {
    if (m === "signIn") {
      const res = await signIn!.create({ identifier: addr });
      const f = res.supportedFirstFactors?.find((x) => x.strategy === "email_code") as { emailAddressId?: string } | undefined;
      if (!f?.emailAddressId) throw new Error("no email_code");
      await signIn!.prepareFirstFactor({ strategy: "email_code", emailAddressId: f.emailAddressId });
    } else {
      await signUp!.create({ emailAddress: addr });
      await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
    }
  };

  const onEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !isLoaded) return;
    const addr = email.trim().toLowerCase();
    if (!addr) return;
    setBusy(true);
    try {
      let m: "signIn" | "signUp" = "signIn";
      try { await sendCode(addr, "signIn"); }
      catch (err) {
        if (errCode(err) !== "form_identifier_not_found") throw err;
        m = "signUp"; await sendCode(addr, "signUp");
      }
      setMode(m); setEmail(addr); setCode(""); setStep("code"); startWait();
    } catch (err) {
      setError((err as { errors?: { longMessage?: string }[] })?.errors?.[0]?.longMessage ?? UNAVAILABLE);
    } finally { setBusy(false); }
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !isLoaded) return;
    setBusy(true);
    try {
      const r = mode === "signIn"
        ? await signIn!.attemptFirstFactor({ strategy: "email_code", code })
        : await signUp!.attemptEmailAddressVerification({ code });
      if (r.status !== "complete") throw new Error("incomplete");
      await setActive!({ session: r.createdSessionId });
      close();
    } catch { setError(BAD_CODE); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    if (busy || resendWait) return;
    setBusy(true);
    try { await sendCode(email, mode); startWait(); setError(null); }
    catch { setError(UNAVAILABLE); }
    finally { setBusy(false); }
  };

  const alert = error ? <p className="dsi-error" role="alert">{error}</p> : null;
  return (
    <Sheet title="Sign in to SentinelPDF" onClose={close}>
      <div className="sigBody dsi-body">
        {step === "choose" ? (
          <>
            <button type="button" className="sigPrimary acct-wide" onClick={() => { desktopBridge()?.startBrowserSignIn?.(); setStep("waiting"); }}>Sign in with your browser</button>
            <button type="button" className="acct-link" onClick={() => setStep("email")}>Use an email code instead</button>
            <p className="acct-note">Google and email links open in your browser.</p>
            {alert}
          </>
        ) : null}
        {step === "waiting" ? (
          <>
            <p className="dsi-status" role="status">Finish signing in in your browser…</p>
            <button type="button" className="acct-link" onClick={() => setStep("choose")}>Cancel</button>
            <button type="button" className="acct-link" onClick={() => setStep("email")}>Use an email code instead</button>
          </>
        ) : null}
        {step === "email" ? (
          <form className="dsi-form" onSubmit={onEmail}>
            <label className="dsi-label" htmlFor="dsi-email">Email</label>
            <input id="dsi-email" className="dsi-input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="sigPrimary acct-wide" disabled={busy}>Email me a code</button>
            {alert}
          </form>
        ) : null}
        {step === "code" ? (
          <form className="dsi-form" onSubmit={onCode}>
            <label className="dsi-label" htmlFor="dsi-code">6-digit code sent to {email}</label>
            <input id="dsi-code" className="dsi-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <button type="submit" className="sigPrimary acct-wide" disabled={busy || code.length < 6}>Continue</button>
            <button type="button" className="acct-link" disabled={resendWait || busy} onClick={() => void resend()}>Resend code</button>
            <button type="button" className="acct-link" onClick={() => setStep("email")}>Use a different email</button>
            {alert}
          </form>
        ) : null}
        {step === "unavailable" ? <p className="dsi-error" role="alert">{UNAVAILABLE}</p> : null}
      </div>
    </Sheet>
  );
}
