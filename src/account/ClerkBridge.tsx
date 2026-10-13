import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useAiStore } from "../store/ai";

let authTokenGetter: (() => Promise<string | null>) | null = null;
export const setAuthTokenGetter = (fn: (() => Promise<string | null>) | null): void => { authTokenGetter = fn; };
export const getAuthToken = (): Promise<string | null> => authTokenGetter?.() ?? Promise.resolve(null);

/** Renders nothing; must be mounted inside <ClerkProvider>. Hands Clerk's token getter to the AI client and resets its session on sign-in/out. */
export function ClerkBridge(): null {
  const { getToken, isSignedIn } = useAuth();
  setAuthTokenGetter(() => getToken());
  useEffect(() => { useAiStore.getState().client?.resetSession(); }, [isSignedIn]);
  return null;
}
