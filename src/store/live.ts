// src/store/live.ts
import { create } from "zustand";
import { LiveClient, type StartSession } from "../live/liveClient";
import { formatPassages, keywordPassages, overview, NO_MATCH } from "../live/grounding";
import { retrievePassages } from "./search";
import { documentText } from "../pdf/text";
import { useDocumentStore } from "./document";
import { useAiStore } from "./ai";

export const SESSION_CAP_S = 600;
export const SILENCE_S = 120;

export interface LiveState {
  status: "idle" | "connecting" | "live" | "ending" | "error";
  error: string | null;
  captions: { role: "you" | "assistant"; text: string }[];
  seconds: number;
  remainingSeconds: number | null;
  resetAt: number | null;
  muted: boolean;
  acknowledged: boolean;
  searching: boolean;
  keywordMode: boolean;
  conversationId: string | null;
  start(): Promise<void>;
  end(): Promise<void>;
  setMuted(on: boolean): void;
  acknowledge(): void;
}

export interface LiveDeps {
  retrieve: typeof retrievePassages;
  documentText: typeof documentText;
  startSession?: StartSession;
  getMedia: () => Promise<void>;
  now: () => number;
}
const deps: LiveDeps = {
  retrieve: retrievePassages,
  documentText,
  getMedia: async () => { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); for (const t of s.getTracks()) t.stop(); },
  now: () => Date.now(),
};
export function configureLiveDeps(partial: Partial<LiveDeps>): void { Object.assign(deps, partial); }

const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function errorMessage(code: string, resetAt?: number): string {
  switch (code) {
    case "voice_limit": return `Voice allowance used for today; resets at ${resetAt ? fmtTime(resetAt) : "midnight UTC"}.`;
    case "voice_unavailable": return "Voice service unavailable right now.";
    case "verification_failed": return "Verification failed. Reload the page and try again.";
    case "network": case "connect_timeout": return "Connection lost";
    default: return "Voice could not start.";
  }
}

let client: LiveClient | null = null;
let startedAt = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
let silence: ReturnType<typeof setTimeout> | null = null;
let reported = false;

export const useLiveStore = create<LiveState>((set, get) => {
  const clearTimers = () => { if (ticker) clearInterval(ticker); ticker = null; if (silence) clearTimeout(silence); silence = null; };
  const elapsed = () => (startedAt === 0 ? 0 : Math.min(SESSION_CAP_S, Math.round((deps.now() - startedAt) / 1000)));
  const armSilence = () => { if (silence) clearTimeout(silence); silence = setTimeout(() => { void get().end(); }, SILENCE_S * 1000); };

  const report = async (keepalive = false, secs?: number) => {
    const id = get().conversationId;
    if (!id || reported) return;
    reported = true;
    const api = useAiStore.getState().client;
    const r = await api?.reportLiveUsage(id, secs ?? elapsed(), keepalive);
    if (r) set({ remainingSeconds: r.remainingSeconds });
  };

  const search = async (query: string): Promise<string> => {
    set({ searching: true });
    try {
      let passages: { page: number; text: string }[] | null = null;
      try { const r = await deps.retrieve(query, 4); if (Array.isArray(r) && r.length > 0) passages = r; } catch { passages = null; }
      if (!passages) {
        set({ keywordMode: true });
        passages = keywordPassages(await deps.documentText("all"), query);
      }
      return passages.length ? formatPassages(passages) : NO_MATCH;
    } finally { set({ searching: false }); }
  };

  const finish = (status: "idle" | "error", error: string | null) => {
    clearTimers();
    client = null;
    set({ status, error, searching: false, muted: false });
  };

  return {
    status: "idle", error: null, captions: [], seconds: 0, remainingSeconds: null, resetAt: null,
    muted: false, acknowledged: false, searching: false, keywordMode: false, conversationId: null,
    acknowledge: () => set({ acknowledged: true }),
    setMuted: (on) => { client?.mute(on); set({ muted: on }); },

    async start() {
      if (get().status !== "idle" && get().status !== "error") return;
      const api = useAiStore.getState().client;
      if (!api) { set({ status: "error", error: "Voice could not start." }); return; }
      set({ status: "connecting", error: null, captions: [], seconds: 0, searching: false, keywordMode: false, conversationId: null });
      startedAt = 0;
      try { await deps.getMedia(); } catch { set({ status: "error", error: "Microphone access is needed for voice." }); return; }
      reported = false;
      const live = new LiveClient(
        { createSession: async () => { const s = await api.createLiveSession(); set({ conversationId: s.conversationId, resetAt: s.resetAt }); return s; } },
        {
          onConnected: () => {
            const doc = useDocumentStore.getState();
            const src = doc.sources.get(doc.pages[0]?.sourceId ?? "");
            void deps.documentText("all").then((pages) => { if (client === live) live.sendContext(overview(src?.name ?? "document", doc.pages.length, pages[0]?.text ?? "")); }).catch(() => {});
          },
          onUserText: (text) => { armSilence(); set({ captions: [...get().captions, { role: "you", text }] }); },
          onAgentText: (text) => { armSilence(); set({ captions: [...get().captions, { role: "assistant", text }] }); },
          onAgentCorrection: (text) => {
            const c = [...get().captions];
            for (let i = c.length - 1; i >= 0; i--) if (c[i].role === "assistant") { c[i] = { role: "assistant", text }; break; }
            set({ captions: c });
          },
          onInterruption: () => armSilence(),
          onError: (m) => console.warn("voice:", m),
          onDisconnected: (reason) => {
            if (client !== live || get().status === "ending") return; // end() owns the user-initiated path
            void report();
            if (reason === "error") finish("error", "Connection lost");
            else finish("idle", "Session ended");
          },
        },
        search,
        deps.startSession ? { startSession: deps.startSession } : {},
      );
      client = live;
      try {
        const { remainingSeconds } = await live.start();
        if (client !== live) { void live.close(); return; }
        startedAt = deps.now();
        set({ status: "live", remainingSeconds, seconds: 0 });
        ticker = setInterval(() => {
          set({ seconds: elapsed() });
          if (elapsed() >= SESSION_CAP_S) void get().end();
        }, 1000);
        armSilence();
      } catch (err) {
        if (client !== live) return;
        const e = err as Error & { resetAt?: number };
        const code = e.name === "NotAllowedError" || e.name === "NotFoundError" ? "mic" : e.message;
        if (get().conversationId) void report();
        finish("error", code === "mic" ? "Microphone access is needed for voice." : errorMessage(code, e.resetAt));
      }
    },

    async end() {
      const live = client;
      if (!live || get().status === "ending") return;
      set({ status: "ending" });
      const secs = elapsed();
      await live.close();
      if (client !== live) return; // a remote disconnect already finished the session
      await report(false, secs);
      finish("idle", "Session ended");
    },
  };
});

// Document change while live ends the session.
useDocumentStore.subscribe((s, prev) => {
  if (s.sources === prev.sources) return;
  const st = useLiveStore.getState();
  if (st.status === "live" || st.status === "connecting") void st.end();
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const st = useLiveStore.getState();
    if (st.status !== "live") return;
    const api = useAiStore.getState().client;
    if (st.conversationId && api && !reported) { reported = true; void api.reportLiveUsage(st.conversationId, st.seconds, true); }
    client?.close().catch(() => {});
  });
  // Test hook: an e2e test can install a fake SDK and a fake microphone before the app boots.
  const w = window as unknown as { __pdfstudioLiveStub?: { startSession: StartSession; getMedia?: () => Promise<void> } };
  if (w.__pdfstudioLiveStub) configureLiveDeps({ startSession: w.__pdfstudioLiveStub.startSession, getMedia: w.__pdfstudioLiveStub.getMedia ?? (async () => {}) });
}
