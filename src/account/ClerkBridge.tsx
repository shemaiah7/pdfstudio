import { useEffect, useRef } from "react";
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
  const signedIn = useRef<boolean | undefined>(undefined);
  const prevSignedIn = useRef<boolean | undefined>(undefined);
  useEffect(() => { useAccount.getState().setFromCache(); }, []);
  useEffect(() => {
    const client = useAiStore.getState().client;
    // Clear the offline cache only on an explicit signed-in → signed-out transition.
    if (isSignedIn === false && prevSignedIn.current === true) useAccount.getState().clear();
    prevSignedIn.current = isSignedIn;
    signedIn.current = isSignedIn;
    client?.resetSession();
    if (isSignedIn) void useAccount.getState().refresh();
  }, [isSignedIn]);
  // The AI client is created later by useAiClient; refresh once it appears if already signed in.
  useEffect(() => useAiStore.subscribe((state, prev) => {
    if (prev.client === null && state.client && signedIn.current) {
      state.client.resetSession();
      void useAccount.getState().refresh();
    }
  }), []);
  useEffect(() => {
    if (!isSignedIn) return;
    const onFocus = () => { void useAccount.getState().refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isSignedIn]);
  return null;
}
