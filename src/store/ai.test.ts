// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAiStore } from "./ai";
import { useDocumentStore } from "./document";
import { loadFixture } from "../test/loadFixture";

vi.mock("../pdf/text", () => ({
  documentText: async () => [{ page: 1, text: "hello" }],
  hasAnyText: (p: { text: string }[]) => p.some((x) => x.text.trim()),
}));

const s = () => useAiStore.getState();

beforeEach(() => { useAiStore.getState().resetForNewDocument(); useDocumentStore.getState().reset(); });

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
