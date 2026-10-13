import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useAiStore } from "../store/ai";
import { useAccount } from "./store";

let authTokenGetter: (() => Promise<string | null>) | null = null;
export const setAuthTokenGetter = (fn: (() => Promise<string | null>) | null): void => { authTokenGetter = fn; };
export const getAuthToken = (): Promise<string | null> => authTokenGetter?.() ?? Promise.resolve(null);

/** Renders nothing; must be mounted inside <ClerkProvider>. Hands Clerk's token getter to the AI client, resets its session on sign-in/out, and keeps the account plan in step. */
export function ClerkBridge(): null {
  const { getToken, isSignedIn } = useAuth();
  setAuthTokenGetter(() => getToken());
  useEffect(() => { useAccount.getState().setFromCache(); }, []);
  useEffect(() => {
    const client = useAiStore.getState().client;
    if (isSignedIn === false) useAccount.getState().clear();
    if (isSignedIn === false) client?.resetSession();
    else if (isSignedIn) { client?.resetSession(); void useAccount.getState().refresh(); }
    else client?.resetSession();
  }, [isSignedIn]);
  useEffect(() => {
    if (!isSignedIn) return;
    const onFocus = () => { void useAccount.getState().refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isSignedIn]);
  return null;
}
