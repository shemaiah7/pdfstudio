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
});
