import { useEffect, useRef, useState } from "react";
import { SignInButton, useUser } from "@clerk/clerk-react";
import AccountMenu from "./AccountMenu";
import { initials } from "./initials";
import TrialPill from "./TrialPill";


/** Toolbar slot: "Sign in" when signed out, otherwise trial pill + avatar that opens the account menu. Needs ClerkProvider. */
export default function AccountEntry({ className = "" }: { className?: string }) {
  const { isSignedIn, user } = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!isSignedIn) {
    return <div className={`acct-entry ${className}`}><SignInButton mode="modal"><button type="button" className="tb-signin" data-testid="sign-in">Sign in</button></SignInButton></div>;
  }
  const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "";
  return (
    <div className={`acct-entry ${className}`} ref={ref}>
      <TrialPill onClick={() => setOpen(true)} />
      <button type="button" className="acct-avatar-btn" data-testid="account-menu" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{initials(name)}</button>
      {open ? <AccountMenu onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
