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
/** How long the voice search tool waits for on-device retrieval before answering from keyword matches (well under TOOL_TIMEOUT_MS). */
export const RETRIEVE_BUDGET_MS = 2_500;

export interface LiveState {
  status: "idle" | "connecting" | "live" | "ending" | "error";
  error: string | null;
  /** The last start was refused by a usage limit (drives the Upgrade to Pro button). */
  limited: boolean;
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
const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
const LIMIT_CODES = new Set(["voice_limit", "monthly_limit"]);
type LimitInfo = { resetAt?: number; remainingSeconds?: number; sessionSeconds?: number };
function errorMessage(code: string, info: LimitInfo = {}): string {
  const at = info.resetAt ? fmtTime(info.resetAt) : "midnight UTC";
  switch (code) {
    case "voice_limit": {
      // A session reserves its full length up front, so a start can be refused while some minutes remain.
      const left = Math.floor((info.remainingSeconds ?? 0) / 60), need = Math.round((info.sessionSeconds ?? 0) / 60);
      if (left >= 1 && need > left) return `Voice sessions need ${need} free minutes to start — you have ${left}. More time frees up at ${at}.`;
      return `Voice allowance used for today; resets at ${at}.`;
    }
    case "monthly_limit": return `Monthly limit reached. Resets ${info.resetAt ? fmtDate(info.resetAt) : "next month"}.`;
    case "account_required": return "Create a free account to use this.";
    case "pro_required": return "Deep OCR is part of Pro.";
    case "voice_unavailable": return "Voice service unavailable right now.";
    case "verification_failed": return "Couldn't verify you're human. Try again.";
    case "network": case "connect_timeout": return "Connection lost";
    default: return "Voice could not start.";
  }
}

let client: LiveClient | null = null;
let startedAt = 0;
let sessionCapS = SESSION_CAP_S; // min(SESSION_CAP_S, the Worker's maxSeconds) for the current session
let ticker: ReturnType<typeof setInterval> | null = null;
let silence: ReturnType<typeof setTimeout> | null = null;
const reportedClients = new WeakSet<LiveClient>();

export const useLiveStore = create<LiveState>((set, get) => {
  const clearTimers = () => { if (ticker) clearInterval(ticker); ticker = null; if (silence) clearTimeout(silence); silence = null; };
  const elapsed = () => (startedAt === 0 ? 0 : Math.min(sessionCapS, Math.round((deps.now() - startedAt) / 1000)));
  const armSilence = () => { if (silence) clearTimeout(silence); silence = setTimeout(() => { void get().end(); }, SILENCE_S * 1000); };

  const report = async (keepalive = false, secs?: number) => {
    const id = get().conversationId;
    if (!id || !client || reportedClients.has(client)) return;
    reportedClients.add(client);
    const api = useAiStore.getState().client;
    const r = await api?.reportLiveUsage(id, secs ?? elapsed(), keepalive);
    if (r) set({ remainingSeconds: r.remainingSeconds });
  };

  // A session cancelled while connecting: tell the worker it never ran (best effort).
  const reportCancelled = (live: LiveClient) => {
    const id = live.conversationId;
    const api = useAiStore.getState().client;
    if (!id || !api || reportedClients.has(live)) return;
    reportedClients.add(live);
    void Promise.resolve(api.reportLiveUsage(id, 0)).catch(() => {});
  };

  const search = async (query: string): Promise<string> => {
    set({ searching: true });
    // Keyword matching runs alongside retrieval: a slow on-device embed must not use up the tool's
    // TOOL_TIMEOUT_MS and answer "no match" for text that is plainly in the document.
    const keyword = deps.documentText("all").then((pages) => keywordPassages(pages, query)).catch(() => []);
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      let passages: { page: number; text: string }[] | null = null;
      try {
        const budget = new Promise<null>((r) => { timer = setTimeout(() => r(null), RETRIEVE_BUDGET_MS); });
        const r = await Promise.race([deps.retrieve(query, 4), budget]);
        if (Array.isArray(r) && r.length > 0) passages = r;
      } catch { passages = null; }
      if (!passages) {
        set({ keywordMode: true });
        passages = await keyword;
      }
      return passages.length ? formatPassages(passages) : NO_MATCH;
    } finally { if (timer) clearTimeout(timer); set({ searching: false }); }
  };

  const finish = (status: "idle" | "error", error: string | null) => {
    clearTimers();
    client = null;
    set({ status, error, searching: false, muted: false });
  };

  return {
    status: "idle", error: null, limited: false, captions: [], seconds: 0, remainingSeconds: null, resetAt: null,
    muted: false, acknowledged: false, searching: false, keywordMode: false, conversationId: null,
    acknowledge: () => set({ acknowledged: true }),
    setMuted: (on) => { client?.mute(on); set({ muted: on }); },

    async start() {
      if (get().status !== "idle" && get().status !== "error") return;
      const api = useAiStore.getState().client;
      if (!api) { set({ status: "error", error: "Voice could not start." }); return; }
      set({ status: "connecting", error: null, limited: false, captions: [], seconds: 0, searching: false, keywordMode: false, conversationId: null });
      startedAt = 0;
      sessionCapS = SESSION_CAP_S;
      try { await deps.getMedia(); } catch { set({ status: "error", error: "Microphone access is needed for voice." }); return; }
      const live = new LiveClient(
        { createSession: async () => { const s = await api.createLiveSession(); sessionCapS = Math.min(SESSION_CAP_S, s.maxSeconds ?? SESSION_CAP_S); set({ conversationId: s.conversationId, resetAt: s.resetAt }); return s; } },
        {
          onConnected: () => {}, // the overview is sent once start() resolves, when the SDK conversation exists
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
        if (client !== live) { reportCancelled(live); void live.close(); return; }
        startedAt = deps.now();
        const doc = useDocumentStore.getState();
        live.sendContext(overview(doc.sources.get(doc.pages[0]?.sourceId ?? "")?.name ?? "document", doc.pages.length));
        set({ status: "live", remainingSeconds, seconds: 0 });
        ticker = setInterval(() => {
          set({ seconds: elapsed() });
          if (elapsed() >= sessionCapS) void get().end();
        }, 1000);
        armSilence();
      } catch (err) {
        if (client !== live) { reportCancelled(live); return; }
        const e = err as Error & LimitInfo;
        const code = e.name === "NotAllowedError" || e.name === "NotFoundError" ? "mic" : e.message;
        if (get().conversationId) void report();
        finish("error", code === "mic" ? "Microphone access is needed for voice." : errorMessage(code, e));
        if (LIMIT_CODES.has(code)) set({ limited: true });
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
    if (st.conversationId && api && client && !reportedClients.has(client)) { reportedClients.add(client); void api.reportLiveUsage(st.conversationId, st.seconds, true); }
    client?.close().catch(() => {});
  });
  // Test hook: an e2e test can install a fake SDK and a fake microphone before the app boots.
  const w = window as unknown as { __pdfstudioLiveStub?: { startSession: StartSession; getMedia?: () => Promise<void> } };
  if (w.__pdfstudioLiveStub) configureLiveDeps({ startSession: w.__pdfstudioLiveStub.startSession, getMedia: w.__pdfstudioLiveStub.getMedia ?? (async () => {}) });
}
