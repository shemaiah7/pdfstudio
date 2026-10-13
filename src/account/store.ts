import { create } from "zustand";
import type { MeResponse } from "../ai/client";
import type { Plan } from "./capabilities";
import { useAiStore } from "../store/ai";
import { isSignedIn } from "./authState";

export const CACHE_KEY = "pdfstudio.account";
export const CACHE_MAX_AGE_MS = 7 * 86400 * 1000;

interface AccountState { me: MeResponse | null; loading: boolean; error: string | null; refresh(): Promise<void>; clear(): void; setFromCache(): void; plan(): Plan }

export const useAccount = create<AccountState>((set, get) => ({
  me: null, loading: false, error: null,
  plan: () => get().me?.plan ?? "anon",
  async refresh() {
    const client = useAiStore.getState().client;
    if (!client) return;
    set({ loading: true, error: null });
    try {
      const prev = get().me?.plan;
      let me = await client.me();
      // Signed in but the session is anonymous (e.g. minted before sign-in finished): re-authenticate once.
      if (me.plan === "anon" && isSignedIn()) { client.resetSession(); me = await client.me(); }
      // Never replace a signed-in user's plan (or its offline cache) with "anon".
      if (me.plan === "anon" && isSignedIn()) { set({ loading: false, error: "verification_failed" }); return; }
      // The session token carries the plan; drop it when the plan changes so /ai, /ocr and /live see the new one.
      if (prev && prev !== me.plan) client.resetSession();
      set({ me, loading: false });
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), me })); } catch { /* storage blocked */ }
    } catch (err) { set({ loading: false, error: (err as Error).message }); }
  },
  clear() { set({ me: null }); try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } },
  setFromCache() {
    if (get().me) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as { at: number; me: MeResponse };
      if (Date.now() - c.at < CACHE_MAX_AGE_MS) set({ me: c.me });
    } catch { /* ignore */ }
  },
}));
