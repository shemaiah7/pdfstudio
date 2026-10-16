import { cloneElement, type ReactElement } from "react";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";
import { isDesktop } from "../../desktop/bridge";
import { useDesktopSignIn } from "../../account/desktopSignIn";

/** Clerk's modal on the web; the desktop sign-in panel inside the desktop app (Google and magic links can't complete in an app window). */
export default function SignInTrigger({ mode, children, onBeforeOpen }: { mode: "sign-in" | "sign-up"; children: ReactElement<{ onClick?: () => void }>; onBeforeOpen?: () => void }) {
  if (isDesktop()) return cloneElement(children, { onClick: () => { onBeforeOpen?.(); useDesktopSignIn.getState().openPanel(); } });
  return mode === "sign-up" ? <SignUpButton mode="modal">{children}</SignUpButton> : <SignInButton mode="modal">{children}</SignInButton>;
}
