// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAiStore } from "./ai";
import { useDocumentStore } from "./document";
import { loadFixture } from "../test/loadFixture";

const docText = vi.hoisted(() => ({ fn: async (_scope: string): Promise<{ page: number; text: string }[]> => [{ page: 1, text: "hello" }] }));
vi.mock("../pdf/text", () => ({
  documentText: (scope: "all" | "selected") => docText.fn(scope),
  hasAnyText: (p: { text: string }[]) => p.some((x) => x.text.trim()),
}));

const s = () => useAiStore.getState();

beforeEach(() => { docText.fn = async () => [{ page: 1, text: "hello" }]; useAiStore.getState().resetForNewDocument(); useDocumentStore.getState().reset(); });

describe("ai store", () => {
  it("streams a summary into state and tracks remaining", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    const fakeClient = {
      runTask: (_b: unknown, h: { onDelta(t: string): void; onDone(d: unknown): void }) => {
        h.onDelta("Sum"); h.onDelta("mary");
        h.onDone({ usage: { input: 1, output: 1 }, stop: "end_turn", remaining: { requests: 18, tokens: 5 }, resetAt: 99 });
        return { abort() {}, done: Promise.resolve() };
      },
    };
    s().setClient(fakeClient as never);
    await s().run("summarize");
    expect(s().summary).toMatchObject({ text: "Summary", status: "done" });
    expect(s().remaining).toEqual({ requests: 18, tokens: 5, resetAt: 99 });
  });

  it("sets limitedUntil and a message on daily_limit", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    s().setClient({ runTask: (_b: unknown, h: { onError(c: string, e?: unknown): void }) => { h.onError("daily_limit", { resetAt: 1_800_000_000 }); return { abort() {}, done: Promise.resolve() }; } } as never);
    await s().run("summarize");
    expect(s().limitedUntil).toBe(1_800_000_000);
    expect(s().summary.status).toBe("error");
    expect(s().summary.error).toMatch(/Daily limit reached/);
  });

  it("maps the account and plan limit errors", () => {
    const m = useAiStore.getState().errorMessage;
    expect(m("account_required")).toBe("Create a free account to use this.");
    expect(m("pro_required")).toBe("Deep OCR is part of Pro.");
    const resetAt = 1_900_000_000;
    const date = new Date(resetAt * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
    expect(m("monthly_limit", { resetAt })).toBe(`Monthly limit reached. Resets ${date}.`);
    expect(m("daily_limit", { resetAt })).toMatch(/^Daily limit reached\. Resets at /);
    expect(m("signin_required")).toBe("Please sign in again.");
  });
  it("monthly_limit also sets limitedUntil", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    s().setClient({ runTask: (_b: unknown, h: { onError(c: string, e?: unknown): void }) => { h.onError("monthly_limit", { resetAt: 1_800_000_000 }); return { abort() {}, done: Promise.resolve() }; } } as never);
    await s().run("summarize");
    expect(s().limitedUntil).toBe(1_800_000_000);
    expect(s().summary.error).toMatch(/^Monthly limit reached\. Resets /);
  });

  it("ask appends turns and resets on new document", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    s().setClient({ runTask: (_b: unknown, h: { onDelta(t: string): void; onDone(d: unknown): void }) => { h.onDelta("A1"); h.onDone({ usage: { input: 0, output: 0 }, stop: "end_turn", remaining: { requests: 1, tokens: 1 }, resetAt: 1 }); return { abort() {}, done: Promise.resolve() }; } } as never);
    s().setDraft("Q1");
    await s().run("ask");
    expect(s().chat.turns).toEqual([{ role: "user", text: "Q1" }, { role: "assistant", text: "A1" }]);
    s().resetForNewDocument();
    expect(s().chat.turns).toEqual([]);
  });

  it("ask error then ask again sends no empty history turn", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    s().setClient({ runTask: (_b: unknown, h: { onError(c: string): void }) => { h.onError("busy"); return { abort() {}, done: Promise.resolve() }; } } as never);
    s().setDraft("Q1");
    await s().run("ask");
    expect(s().chat.turns.some((t) => t.role === "assistant" && t.text === "")).toBe(false);
    useAiStore.setState((st) => ({ chat: { ...st.chat, turns: [...st.chat.turns, { role: "assistant", text: "x".repeat(9000) }, { role: "assistant", text: "" }] } }));
    let body: { history?: { text: string }[] } = {};
    s().setClient({ runTask: (b: typeof body, h: { onDone(d: unknown): void }) => { body = b; h.onDone({ usage: { input: 0, output: 0 }, stop: "end_turn", remaining: { requests: 1, tokens: 1 }, resetAt: 1 }); return { abort() {}, done: Promise.resolve() }; } } as never);
    s().setDraft("Q2");
    await s().run("ask");
    expect(body.history!.length).toBeGreaterThan(0);
    expect(body.history!.every((t) => t.text.length > 0 && t.text.length <= 8000)).toBe(true);
    expect(body.history!.some((t) => t.text.length === 8000)).toBe(true);
  });

  it("ignores a second run while running", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    let release!: () => void;
    const runTask = vi.fn(() => ({ abort() {}, done: new Promise<void>((r) => { release = r; }) }));
    s().setClient({ runTask } as never);
    const first = s().run("summarize");
    await s().run("summarize");
    expect(runTask).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1));
    release(); await first;
  });
});

const okDone = { usage: { input: 0, output: 0 }, stop: "end_turn", remaining: { requests: 1, tokens: 1 }, resetAt: 1 };

describe("document cap and scope", () => {
  it("rejects an oversized document without calling the client", async () => {
    docText.fn = async () => [{ page: 1, text: "x".repeat(600_001) }];
    const runTask = vi.fn();
    s().setClient({ runTask } as never);
    for (const task of ["summarize", "extract"] as const) {
      await s().run(task);
      expect(runTask).not.toHaveBeenCalled();
    }
    expect(s().summary.error).toBe(s().errorMessage("document_too_large"));
    expect(s().summary.status).toBe("error");
    expect(s().extract.error).toBe(s().errorMessage("document_too_large"));
    s().setDraft("Q");
    await s().run("ask");
    expect(runTask).not.toHaveBeenCalled();
    expect(s().chat.error).toBe(s().errorMessage("document_too_large"));
  });

  it("rewrite sends only the selection page and its neighbours", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    const pages = useDocumentStore.getState().pages;
    docText.fn = async () => [1, 2, 3, 4, 5].map((n) => ({ page: n, text: `t${n}` }));
    let body: { document?: { page: number }[] } = {};
    s().setClient({ runTask: (b: typeof body, h: { onDone(d: unknown): void }) => { body = b; h.onDone(okDone); return { abort() {}, done: Promise.resolve() }; } } as never);
    s().setSelection({ pageEntryId: pages[1].id, text: "sel", boxes: [{ x: 0, y: 0, width: 1, height: 1 }], fontSize: 12, bold: false, serif: false });
    await s().run("rewrite");
    expect(body.document!.map((d) => d.page)).toEqual([1, 2, 3]);
  });

  it("ask honors scope selected", async () => {
    const seen: string[] = [];
    docText.fn = async (scope) => { seen.push(scope); return [{ page: 2, text: "hi" }]; };
    s().setClient({ runTask: (_b: unknown, h: { onDone(d: unknown): void }) => { h.onDone(okDone); return { abort() {}, done: Promise.resolve() }; } } as never);
    s().setScope("selected");
    s().setDraft("Q");
    await s().run("ask");
    expect(seen).toEqual(["selected"]);
  });

  it("says to select pages first when the selected scope is empty", async () => {
    docText.fn = async () => [];
    const runTask = vi.fn();
    s().setClient({ runTask } as never);
    s().setScope("selected");
    await s().run("summarize");
    expect(runTask).not.toHaveBeenCalled();
    expect(s().summary.error).toBe("Select pages first.");
  });
});

describe("document change", () => {
  it("aborts pending streams, ignores late callbacks, and accepts a new run", async () => {
    await useDocumentStore.getState().openFiles([{ name: "three.pdf", bytes: loadFixture("three") }]);
    let handlers!: { onDelta(t: string): void; onDone(d: unknown): void };
    const abort = vi.fn();
    const runTask = vi.fn((_b: unknown, h: typeof handlers) => { handlers = h; return { abort, done: new Promise<void>(() => {}) }; });
    s().setClient({ runTask } as never);
    void s().run("summarize");
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1));
    s().resetForNewDocument();
    expect(abort).toHaveBeenCalledTimes(1);
    handlers.onDelta("late");
    handlers.onDone(okDone);
    expect(s().summary.text).toBe("");
    expect(s().summary.status).toBe("idle");
    void s().run("summarize");
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(2));
  });
});

describe("setSelection reset", () => {
  const sel = (text: string) => ({ pageEntryId: "p1", text, boxes: [{ x: 0, y: 0, width: 10, height: 10 }], fontSize: 12, bold: false, serif: false });
  it("clears the result on a different selection but keeps it for an identical one", () => {
    const st = useAiStore;
    st.getState().setSelection(sel("a"));
    st.setState((s) => ({ rewrite: { ...s.rewrite, result: "R", status: "done" } }));
    st.getState().setSelection(sel("a"));
    expect(st.getState().rewrite.result).toBe("R");
    st.getState().setSelection(sel("b"));
    expect(st.getState().rewrite.result).toBe("");
    expect(st.getState().rewrite.status).toBe("idle");
  });
});

const fakeClient = (onBody: (b: never) => void) => ({
  runTask: (b: never, h: { onDone(d: unknown): void }) => {
    onBody(b);
    h.onDone({ usage: { input: 1, output: 1 }, stop: "end_turn", remaining: { requests: 1, tokens: 1 }, resetAt: 0 });
    return { abort() {}, done: Promise.resolve() };
  },
}) as never;

describe("ask with retrieval", () => {
  it("sends retrieved passages with retrieved:true and records the count", async () => {
    vi.doMock("./search", () => ({ retrievePassages: async () => [{ page: 2, text: "warfarin held" }], useSearchStore: { getState: () => ({ model: { status: "ready" } }) } }));
    const { useAiStore } = await import("./ai");
    const bodies: unknown[] = [];
    useAiStore.setState({ client: fakeClient((b) => bodies.push(b)), useSearch: true, chat: { turns: [], draft: "why?", status: "idle", error: null, passages: null } });
    await useAiStore.getState().run("ask");
    expect(bodies[0]).toMatchObject({ task: "ask", retrieved: true, document: [{ page: 2, text: "warfarin held" }] });
    expect(useAiStore.getState().chat.passages).toBe(1);
  });
  it("falls back to the whole document when nothing matches and the document is small", async () => {
    vi.doMock("./search", () => ({ retrievePassages: async () => [], useSearchStore: { getState: () => ({ model: { status: "ready" } }) } }));
    const { useAiStore } = await import("./ai");
    const bodies: { retrieved?: boolean }[] = [];
    useAiStore.setState({ client: fakeClient((b) => bodies.push(b)), useSearch: true, chat: { turns: [], draft: "why?", status: "idle", error: null, passages: null } });
    await useAiStore.getState().run("ask");
    expect(bodies[0].retrieved).toBeUndefined();
    expect(useAiStore.getState().chat.passages).toBeNull();
  });
  it("falls back to the whole document when retrieval rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("./search", () => ({ retrievePassages: async () => { throw new Error("embed failed"); } }));
    const { useAiStore } = await import("./ai");
    const bodies: { retrieved?: boolean }[] = [];
    useAiStore.setState({ client: fakeClient((b) => bodies.push(b)), useSearch: true, scope: "all", chat: { turns: [], draft: "why?", status: "idle", error: null, passages: null } });
    await useAiStore.getState().run("ask");
    expect(bodies[0].retrieved).toBeUndefined();
    expect(useAiStore.getState().chat.status).toBe("done");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it("skips retrieval when scope is selected", async () => {
    const retrieve = vi.fn(async () => [{ page: 2, text: "x" }]);
    vi.doMock("./search", () => ({ retrievePassages: retrieve }));
    const { useAiStore } = await import("./ai");
    const bodies: { retrieved?: boolean }[] = [];
    useAiStore.setState({ client: fakeClient((b) => bodies.push(b)), useSearch: true, scope: "selected", chat: { turns: [], draft: "why?", status: "idle", error: null, passages: null } });
    await useAiStore.getState().run("ask");
    expect(retrieve).not.toHaveBeenCalled();
    expect(bodies[0].retrieved).toBeUndefined();
    useAiStore.setState({ scope: "all" });
  });
  it("shows an error and sends nothing while documents are still indexing", async () => {
    vi.doMock("./search", () => ({ retrievePassages: async () => "indexing" }));
    const { useAiStore } = await import("./ai");
    const bodies: unknown[] = [];
    useAiStore.setState({ client: fakeClient((b) => bodies.push(b)), useSearch: true, scope: "all", chat: { turns: [], draft: "why?", status: "idle", error: null, passages: null } });
    await useAiStore.getState().run("ask");
    expect(bodies).toHaveLength(0);
    expect(useAiStore.getState().chat).toMatchObject({ status: "error", error: "Still indexing these documents; try again when indexing finishes." });
  });
});

it("no_text copy follows the OCR status", () => {
  useAiStore.setState({ ocrTextStatus: "ok" });
  expect(useAiStore.getState().errorMessage("no_text")).toBe("No text could be recognized. Try Deep OCR.");
  useAiStore.setState({ ocrTextStatus: "recognizing" });
  expect(useAiStore.getState().errorMessage("no_text")).toBe("Recognizing text… try again in a moment.");
  useAiStore.setState({ ocrTextStatus: "ok" });
});

it("Summarize, Ask and Extract refuse to run on partial text while OCR is recognizing", async () => {
  const bodies: unknown[] = [];
  const client = { runTask: (b: unknown) => { bodies.push(b); return { abort() {}, done: Promise.resolve() }; } };
  useAiStore.setState({ client: client as never, ocrTextStatus: "recognizing", scope: "all", chat: { turns: [], draft: "why?", status: "idle", error: null, passages: null } });
  try {
    for (const task of ["summarize", "ask", "extract"] as const) await useAiStore.getState().run(task);
    expect(bodies).toHaveLength(0);
    expect(useAiStore.getState().summary).toMatchObject({ status: "error", error: "Recognizing text… try again in a moment." });
    expect(useAiStore.getState().chat).toMatchObject({ status: "error", error: "Recognizing text… try again in a moment.", draft: "why?" });
    expect(useAiStore.getState().extract).toMatchObject({ status: "error", error: "Recognizing text… try again in a moment." });
  } finally { useAiStore.setState({ ocrTextStatus: "ok" }); }
});
