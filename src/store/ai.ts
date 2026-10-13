import { create } from "zustand";
import type { AiClient, AiRequest } from "../ai/client";
import type { PageSelection } from "../pdf/selection";
import { documentText, hasAnyText } from "../pdf/text";
import { useDocumentStore } from "./document";

export type Status = "idle" | "running" | "done" | "error";
export type RewriteMode = "rewrite" | "simplify" | "formal" | "translate" | "explain";
export interface Fact { label: string; value: string; page: number }

const idle = () => ({ status: "idle" as Status, error: null as string | null });

export interface AiState {
  client: AiClient | null;
  remaining: { requests: number; tokens: number; resetAt: number } | null;
  limitedUntil: number | null;
  limitKind: "daily" | "monthly" | null;
  scope: "all" | "selected";
  summary: { text: string; status: Status; error: string | null };
  chat: { turns: { role: "user" | "assistant"; text: string }[]; draft: string; status: Status; error: string | null; passages: number | null };
  useSearch: boolean;
  ocrTextStatus: "recognizing" | "none" | "ok"; // pushed by the OCR store (which imports this one)
  rewrite: { selection: PageSelection | null; mode: RewriteMode; language: string; result: string; status: Status; error: string | null };
  extract: { facts: Fact[]; status: Status; error: string | null };
  noticeDismissed: boolean;
  setClient(c: AiClient): void;
  setSelection(s: PageSelection | null): void;
  setRewriteMode(m: RewriteMode): void;
  setLanguage(l: string): void;
  setScope(s: "all" | "selected"): void;
  setUseSearch(b: boolean): void;
  setDraft(d: string): void;
  setRewriteResult(t: string): void;
  dismissNotice(): void;
  resetForNewDocument(): void;
  run(task: AiRequest["task"]): Promise<void>;
  errorMessage(code: string, extra?: Record<string, unknown>): string;
}

interface TaskPatch { status?: Status; error?: string | null; text?: string; result?: string; facts?: Fact[] }

const MAX_DOC_CHARS = 600_000;
const inflight = new Map<AiRequest["task"], symbol>();
const aborts = new Map<AiRequest["task"], () => void>();
// Bumped on every document change; callbacks from older generations are ignored.
let generation = 0;

const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

const initial = () => ({
  remaining: null, limitedUntil: null, limitKind: null,
  scope: "all" as "all" | "selected",
  summary: { text: "", ...idle() },
  chat: { turns: [], draft: "", passages: null as number | null, ...idle() },
  rewrite: { selection: null, mode: "rewrite" as RewriteMode, language: "", result: "", ...idle() },
  extract: { facts: [] as Fact[], ...idle() },
});

export const useAiStore = create<AiState>((set, get) => ({
  client: null,
  useSearch: true,
  ocrTextStatus: "ok",
  noticeDismissed: (() => { try { return localStorage.getItem("ai-notice") === "1"; } catch { return false; } })(),
  ...initial(),

  setClient: (client) => set({ client }),
  setSelection: (selection) => set((s) => {
    const cur = s.rewrite.selection;
    const same = !!cur && !!selection && cur.pageEntryId === selection.pageEntryId && cur.text === selection.text;
    return { rewrite: same || (!cur && !selection) ? { ...s.rewrite, selection } : { ...s.rewrite, selection, result: "", status: "idle" as Status, error: null } };
  }),
  setRewriteMode: (mode) => set((s) => ({ rewrite: { ...s.rewrite, mode } })),
  setLanguage: (language) => set((s) => ({ rewrite: { ...s.rewrite, language } })),
  setScope: (scope) => set({ scope }),
  setUseSearch: (useSearch) => set({ useSearch }),
  setDraft: (draft) => set((s) => ({ chat: { ...s.chat, draft } })),
  setRewriteResult: (result) => set((s) => ({ rewrite: { ...s.rewrite, result } })),
  dismissNotice: () => { try { localStorage.setItem("ai-notice", "1"); } catch { /* ignore */ } set({ noticeDismissed: true }); },
  resetForNewDocument: () => {
    generation++;
    for (const abort of aborts.values()) { try { abort(); } catch { /* ignore */ } }
    aborts.clear();
    inflight.clear();
    set((s) => ({ ...initial(), remaining: s.remaining, limitedUntil: s.limitedUntil, limitKind: s.limitKind }));
  },

  errorMessage(code, extra) {
    switch (code) {
      case "verification_failed": return "Couldn't verify you're human. Try again.";
      case "signin_required": return "Please sign in again.";
      case "daily_limit": return `Daily limit reached. Resets at ${fmtTime(Number(extra?.resetAt ?? 0))}.`;
      case "monthly_limit": return `Monthly limit reached. Resets ${fmtDate(Number(extra?.resetAt ?? 0))}.`;
      case "account_required": return "Create a free account to use this.";
      case "pro_required": return "Deep OCR is part of Pro.";
      case "too_fast": return "Slow down a little and try again in a few seconds.";
      case "document_too_large": return "Document is too large to send whole; select pages and try again.";
      case "busy": return "AI is busy, try again in a minute.";
      case "refused": return "Claude declined this request.";
      case "interrupted": return "Response interrupted.";
      case "network": return "Couldn't reach the AI service.";
      case "no_selection": return "Select pages first.";
      case "no_text": return get().ocrTextStatus === "recognizing" ? "Recognizing text… try again in a moment." : "No text could be recognized. Try Deep OCR.";
      default: return "Something went wrong talking to the AI.";
    }
  },

  async run(task) {
    const { client } = get();
    if (!client) return;
    const current = { summarize: get().summary, ask: get().chat, rewrite: get().rewrite, extract: get().extract }[task];
    if (current.status === "running" || inflight.has(task)) return;
    const mine = Symbol(task);
    inflight.set(task, mine);
    try { await runTask(task, client); } finally { if (inflight.get(task) === mine) inflight.delete(task); }
  },
}));

async function runTask(task: AiRequest["task"], client: AiClient) {
  const { get, set } = { get: useAiStore.getState, set: useAiStore.setState };
  const gen = generation;
  const stale = () => gen !== generation;
  {
    const setTask = (p: TaskPatch) => set((s) => {
      const common = { ...(p.status !== undefined && { status: p.status }), ...(p.error !== undefined && { error: p.error }) };
      switch (task) {
        case "summarize": return { summary: { ...s.summary, ...common, ...(p.text !== undefined && { text: p.text }) } };
        case "ask": return { chat: { ...s.chat, ...common } };
        case "rewrite": return { rewrite: { ...s.rewrite, ...common, ...(p.result !== undefined && { result: p.result }) } };
        case "extract": return { extract: { ...s.extract, ...common, ...(p.facts !== undefined && { facts: p.facts }) } };
      }
    });
    // Partial text would give a misleading answer; wait until recognition finishes.
    if (task !== "rewrite" && get().ocrTextStatus === "recognizing") { setTask({ status: "error", error: get().errorMessage("no_text") }); return; }
    const scope = task === "rewrite" ? "all" : get().scope;
    let document = await documentText(scope);
    if (stale()) return;
    if (task === "rewrite") {
      // Only the selection's page and its neighbours are sent for a rewrite.
      const sel = get().rewrite.selection;
      const idx = sel ? useDocumentStore.getState().pages.findIndex((p) => p.id === sel.pageEntryId) : -1;
      if (idx < 0) return;
      const p = idx + 1;
      document = document.filter((d) => d.page >= p - 1 && d.page <= p + 1);
    }
    let retrieved = false;
    const q = task === "ask" ? get().chat.draft.trim() : "";
    if (task === "ask" && get().useSearch && scope === "all") {
      let passages: { page: number; text: string }[] | null | "indexing" = null;
      try {
        const { retrievePassages } = await import("./search");
        passages = q ? await retrievePassages(q) : null;
      } catch (e) { console.warn("Retrieval failed; sending the whole document", e); }
      if (stale()) return;
      if (passages === "indexing") { setTask({ status: "error", error: "Still indexing these documents; try again when indexing finishes." }); return; }
      if (passages && passages.length > 0) { document = passages; retrieved = true; }
      else if (passages && passages.length === 0 && document.reduce((n, d) => n + d.text.length, 0) > MAX_DOC_CHARS) {
        set((s) => ({ chat: { ...s.chat, passages: null } }));
        setTask({ status: "error", error: "Nothing in the open documents matched the question" }); return;
      }
    }
    if (scope === "selected" && document.length === 0) { setTask({ status: "error", error: get().errorMessage("no_selection") }); return; }
    if (document.reduce((n, d) => n + d.text.length, 0) > MAX_DOC_CHARS) {
      setTask({ status: "error", error: get().errorMessage("document_too_large") });
      return;
    }
    if (!hasAnyText(document)) { setTask({ status: "error", error: get().errorMessage("no_text") }); return; }

    const body: AiRequest = { task, document };
    if (task === "ask") {
      if (!q) return;
      body.question = q;
      if (retrieved) body.retrieved = true;
      body.history = get().chat.turns.filter((t) => t.text.trim().length > 0).slice(-10).map((t) => ({ ...t, text: t.text.slice(0, 8000) }));
      set((s) => ({ chat: { ...s.chat, turns: [...s.chat.turns, { role: "user", text: q }, { role: "assistant", text: "" }], draft: "", status: "running", error: null, passages: retrieved ? document.length : null } }));
    } else if (task === "rewrite") {
      const r = get().rewrite;
      if (!r.selection) return;
      body.selection = r.selection.text; body.mode = r.mode;
      if (r.mode === "translate") body.language = r.language || "English";
      setTask({ result: "", status: "running", error: null });
    } else if (task === "summarize") {
      setTask({ text: "", status: "running", error: null });
    } else {
      setTask({ facts: [], status: "running", error: null });
    }

    let buffer = "";
    const handle = client.runTask(body, {
      onDelta: (t) => {
        if (stale()) return;
        buffer += t;
        if (task === "summarize") setTask({ text: buffer });
        else if (task === "rewrite") setTask({ result: buffer });
        else if (task === "ask") set((s) => { const turns = [...s.chat.turns]; turns[turns.length - 1] = { role: "assistant", text: buffer }; return { chat: { ...s.chat, turns } }; });
      },
      onDone: (d) => {
        if (stale()) return;
        set({ remaining: { ...d.remaining, resetAt: d.resetAt } });
        if (task === "extract") {
          try { setTask({ facts: (JSON.parse(buffer) as { facts: Fact[] }).facts, status: "done" }); }
          catch { setTask({ status: "error", error: "Couldn't read the extracted facts." }); }
        } else if (d.stop === "max_tokens") {
          setTask({ status: "done", error: "Response was cut short." });
        } else {
          setTask({ status: "done" });
        }
      },
      onError: (code, extra) => {
        if (stale()) return;
        if (code === "daily_limit" || code === "monthly_limit") set({ limitedUntil: Number(extra?.resetAt ?? 0), limitKind: code === "monthly_limit" ? "monthly" : "daily" });
        if (task === "ask") set((s) => {
          const turns = s.chat.turns;
          const last = turns[turns.length - 1];
          return last && last.role === "assistant" && last.text === "" ? { chat: { ...s.chat, turns: turns.slice(0, -1) } } : {};
        });
        setTask({ status: "error", error: get().errorMessage(code, extra) });
      },
    });
    aborts.set(task, handle.abort);
    try { await handle.done; } finally { if (aborts.get(task) === handle.abort) aborts.delete(task); }
  }
}
