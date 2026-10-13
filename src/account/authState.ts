/** Clerk auth state shared with the AI client and the account store (ClerkBridge writes it; no Clerk import here, so no cycles). */
let authTokenGetter: (() => Promise<string | null>) | null = null;
let signedIn = false;
export const setAuthTokenGetter = (fn: (() => Promise<string | null>) | null): void => { authTokenGetter = fn; };
export const getAuthToken = (): Promise<string | null> => authTokenGetter?.() ?? Promise.resolve(null);
export const setSignedIn = (v: boolean): void => { signedIn = v; };
/** True while ClerkBridge reports a signed-in user; the AI client must then never fall back to an anonymous session. */
export const isSignedIn = (): boolean => signedIn;
