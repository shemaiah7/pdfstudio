import { create } from "zustand";
import type { AiClient, AiRequest } from "../ai/client";
import type { PageSelection } from "../pdf/selection";
import { documentText, hasAnyText } from "../pdf/text";

export type Status = "idle" | "running" | "done" | "error";
export type RewriteMode = "rewrite" | "simplify" | "formal" | "translate" | "explain";
export interface Fact { label: string; value: string; page: number }

const idle = () => ({ status: "idle" as Status, error: null as string | null });

export interface AiState {
  client: AiClient | null;
  remaining: { requests: number; tokens: number; resetAt: number } | null;
  limitedUntil: number | null;
  summary: { scope: "all" | "selected"; text: string; status: Status; error: string | null };
  chat: { turns: { role: "user" | "assistant"; text: string }[]; draft: string; status: Status; error: string | null };
  rewrite: { selection: PageSelection | null; mode: RewriteMode; language: string; result: string; status: Status; error: string | null };
  extract: { facts: Fact[]; status: Status; error: string | null };
  noticeDismissed: boolean;
  setClient(c: AiClient): void;
  setSelection(s: PageSelection | null): void;
  setRewriteMode(m: RewriteMode): void;
  setLanguage(l: string): void;
  setSummaryScope(s: "all" | "selected"): void;
  setDraft(d: string): void;
  setRewriteResult(t: string): void;
  dismissNotice(): void;
  resetForNewDocument(): void;
  run(task: AiRequest["task"]): Promise<void>;
  errorMessage(code: string, extra?: Record<string, unknown>): string;
}

interface TaskPatch { status?: Status; error?: string | null; text?: string; result?: string; facts?: Fact[] }

const inflight = new Set<AiRequest["task"]>();

const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const initial = () => ({
  remaining: null, limitedUntil: null,
  summary: { scope: "all" as const, text: "", ...idle() },
  chat: { turns: [], draft: "", ...idle() },
  rewrite: { selection: null, mode: "rewrite" as RewriteMode, language: "", result: "", ...idle() },
  extract: { facts: [] as Fact[], ...idle() },
});

export const useAiStore = create<AiState>((set, get) => ({
  client: null,
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
  setSummaryScope: (scope) => set((s) => ({ summary: { ...s.summary, scope } })),
  setDraft: (draft) => set((s) => ({ chat: { ...s.chat, draft } })),
  setRewriteResult: (result) => set((s) => ({ rewrite: { ...s.rewrite, result } })),
  dismissNotice: () => { try { localStorage.setItem("ai-notice", "1"); } catch { /* ignore */ } set({ noticeDismissed: true }); },
  resetForNewDocument: () => set((s) => ({ ...initial(), remaining: s.remaining, limitedUntil: s.limitedUntil })),

  errorMessage(code, extra) {
    switch (code) {
      case "verification_failed": return "Couldn't verify you're human. Try again.";
      case "daily_limit": return `Daily limit reached. Resets at ${fmtTime(Number(extra?.resetAt ?? 0))}.`;
      case "too_fast": return "Slow down a little and try again in a few seconds.";
      case "document_too_large": return "Document is too large to send whole; select pages and try again.";
      case "busy": return "AI is busy, try again in a minute.";
      case "refused": return "Claude declined this request.";
      case "interrupted": return "Response interrupted.";
      case "network": return "Couldn't reach the AI service.";
      case "no_text": return "This PDF has no selectable text. OCR is coming in a later version.";
      default: return "Something went wrong talking to the AI.";
    }
  },

  async run(task) {
    const { client } = get();
    if (!client) return;
    const current = { summarize: get().summary, ask: get().chat, rewrite: get().rewrite, extract: get().extract }[task];
    if (current.status === "running" || inflight.has(task)) return;
    inflight.add(task);
    try { await runTask(task, client); } finally { inflight.delete(task); }
  },
}));

async function runTask(task: AiRequest["task"], client: AiClient) {
  const { get, set } = { get: useAiStore.getState, set: useAiStore.setState };
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
    const scope = task === "summarize" ? get().summary.scope : "all";
    const document = await documentText(scope);
    if (!hasAnyText(document)) { setTask({ status: "error", error: get().errorMessage("no_text") }); return; }

    const body: AiRequest = { task, document };
    if (task === "ask") {
      const q = get().chat.draft.trim();
      if (!q) return;
      body.question = q;
      body.history = get().chat.turns.filter((t) => t.text.trim().length > 0).slice(-10).map((t) => ({ ...t, text: t.text.slice(0, 8000) }));
      set((s) => ({ chat: { ...s.chat, turns: [...s.chat.turns, { role: "user", text: q }, { role: "assistant", text: "" }], draft: "", status: "running", error: null } }));
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
    await client.runTask(body, {
      onDelta: (t) => {
        buffer += t;
        if (task === "summarize") setTask({ text: buffer });
        else if (task === "rewrite") setTask({ result: buffer });
        else if (task === "ask") set((s) => { const turns = [...s.chat.turns]; turns[turns.length - 1] = { role: "assistant", text: buffer }; return { chat: { ...s.chat, turns } }; });
      },
      onDone: (d) => {
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
        if (code === "daily_limit") set({ limitedUntil: Number(extra?.resetAt ?? 0) });
        if (task === "ask") set((s) => {
          const turns = s.chat.turns;
          const last = turns[turns.length - 1];
          return last && last.role === "assistant" && last.text === "" ? { chat: { ...s.chat, turns: turns.slice(0, -1) } } : {};
        });
        setTask({ status: "error", error: get().errorMessage(code, extra) });
      },
    }).done;
  }
}
