// src/store/live.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useDocumentStore } from "./document";
import { useAiStore } from "./ai";
import { useLiveStore, configureLiveDeps, SESSION_CAP_S, SILENCE_S } from "./live";
import type { LiveConversation, StartSession } from "../live/liveClient";

type Opts = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let opts: Opts = {};
const conv: LiveConversation & { ended: boolean; context: string[] } = {
  ended: false, context: [],
  async endSession() { this.ended = true; queueMicrotask(() => opts.onDisconnect?.({ reason: "user" })); },
  sendContextualUpdate(t) { this.context.push(t); }, setMicMuted() {}, getId: () => "conv_1",
};
const startSession: StartSession = async (o) => { opts = o; queueMicrotask(() => opts.onConnect?.()); return conv; };
const client = { createLiveSession: vi.fn(), reportLiveUsage: vi.fn() };
const retrieve = vi.fn();
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

function openDoc(id = "s1") {
  useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map([[id, { id, name: "note.pdf", bytes: new Uint8Array(), pageCount: 2, hash: "h" }]]), pages: [{ id: `${id}-0`, sourceId: id, sourcePageIndex: 0, rotation: 0 }, { id: `${id}-1`, sourceId: id, sourcePageIndex: 1, rotation: 0 }] });
}

beforeEach(() => {
  vi.useFakeTimers();
  conv.ended = false; conv.context = []; opts = {};
  client.createLiveSession.mockReset().mockResolvedValue({ conversationId: "conv_1", token: "tok", remainingSeconds: 1200, resetAt: 0 });
  client.reportLiveUsage.mockReset().mockResolvedValue({ remainingSeconds: 1705 });
  retrieve.mockReset().mockResolvedValue([{ page: 2, text: "warfarin 5 mg nightly" }]);
  useAiStore.setState({ client: client as never });
  configureLiveDeps({ retrieve: retrieve as never, documentText: async () => [{ page: 1, text: "Cardiology note. Troponin elevated." }, { page: 2, text: "warfarin 5 mg nightly" }], startSession, getMedia: async () => {}, now: () => Date.now() });
  useLiveStore.setState({ status: "idle", error: null, captions: [], seconds: 0, remainingSeconds: null, unlimited: false, resetAt: null, muted: false, acknowledged: true, searching: false, keywordMode: false, conversationId: null });
  openDoc();
});
afterEach(() => { vi.useRealTimers(); });

describe("useLiveStore", () => {
  it("start: mic check, /live, connect, overview context, live", async () => {
    await useLiveStore.getState().start();
    await flush();
    const s = useLiveStore.getState();
    expect(s.status).toBe("live");
    expect(s.conversationId).toBe("conv_1");
    expect(s.remainingSeconds).toBe(1200);
    expect(conv.context[0]).toBe("Document: note.pdf, 2 pages.");
  });
  it("owner sessions: remainingSeconds null, unlimited true", async () => {
    client.createLiveSession.mockResolvedValue({ conversationId: "conv_1", token: "tok", remainingSeconds: null, unlimited: true, resetAt: undefined });
    client.reportLiveUsage.mockResolvedValue({ remainingSeconds: null, unlimited: true });
    await useLiveStore.getState().start();
    await flush();
    expect(useLiveStore.getState()).toMatchObject({ status: "live", remainingSeconds: null, unlimited: true });
    await useLiveStore.getState().end();
    expect(useLiveStore.getState()).toMatchObject({ status: "idle", remainingSeconds: null, unlimited: true });
    useLiveStore.setState({ unlimited: false });
  });
  it("mic denied: error, no /live call, no usage report", async () => {
    configureLiveDeps({ getMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } });
    await useLiveStore.getState().start();
    expect(useLiveStore.getState()).toMatchObject({ status: "error", error: "Microphone access is needed for voice." });
    expect(client.createLiveSession).not.toHaveBeenCalled();
    expect(client.reportLiveUsage).not.toHaveBeenCalled();
  });
  it("voice_limit maps to the reset-time message", async () => {
    client.createLiveSession.mockRejectedValueOnce(Object.assign(new Error("voice_limit"), { resetAt: 1_900_000_000 }));
    await useLiveStore.getState().start();
    expect(useLiveStore.getState().error).toMatch(/^Voice allowance used for today; resets at /);
    expect(useLiveStore.getState().status).toBe("error");
  });
  it("voice_limit with time left explains the per-session reservation instead of saying the day is used up", async () => {
    client.createLiveSession.mockRejectedValueOnce(Object.assign(new Error("voice_limit"), { resetAt: 1_900_000_000, remainingSeconds: 540, sessionSeconds: 600 }));
    await useLiveStore.getState().start();
    expect(useLiveStore.getState().error).toMatch(/^Voice sessions need 10 free minutes to start — you have 9\. More time frees up at .+\.$/);
  });
  it("voice_limit with under a minute left keeps the used-for-today message", async () => {
    client.createLiveSession.mockRejectedValueOnce(Object.assign(new Error("voice_limit"), { resetAt: 1_900_000_000, remainingSeconds: 30, sessionSeconds: 600 }));
    await useLiveStore.getState().start();
    expect(useLiveStore.getState().error).toMatch(/^Voice allowance used for today; resets at /);
  });
  it("voice_unavailable maps to its message", async () => {
    client.createLiveSession.mockRejectedValueOnce(new Error("voice_unavailable"));
    await useLiveStore.getState().start();
    expect(useLiveStore.getState().error).toBe("Voice service unavailable right now.");
  });
  it("search tool uses retrieval when ready and formats passages; keyword fallback otherwise", async () => {
    await useLiveStore.getState().start(); await flush();
    expect(await opts.clientTools.search_document({ query: "warfarin" })).toBe("[p. 2] warfarin 5 mg nightly");
    expect(useLiveStore.getState().keywordMode).toBe(false);
    retrieve.mockResolvedValueOnce(null);
    expect(await opts.clientTools.search_document({ query: "troponin" })).toContain("[p. 1] Cardiology note. Troponin elevated.");
    expect(useLiveStore.getState().keywordMode).toBe(true);
    retrieve.mockResolvedValueOnce("indexing");
    expect(await opts.clientTools.search_document({ query: "warfarin" })).toContain("[p. 2]");
    retrieve.mockResolvedValueOnce([]);
    expect(await opts.clientTools.search_document({ query: "zzzz" })).toBe("No passage in the document matched that query.");
    expect(useLiveStore.getState().searching).toBe(false);
  });
  it("search tool answers from keywords when retrieval is too slow, instead of timing out with no match", async () => {
    await useLiveStore.getState().start(); await flush();
    retrieve.mockReturnValueOnce(new Promise(() => {})); // e.g. the on-device search model embedding slowly on CPU
    const result = opts.clientTools.search_document({ query: "troponin" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toContain("[p. 1] Cardiology note. Troponin elevated.");
    expect(useLiveStore.getState().keywordMode).toBe(true);
    expect(useLiveStore.getState().searching).toBe(false);
  });
  it("search tool falls back to keywords when retrieval finds nothing above its threshold", async () => {
    await useLiveStore.getState().start(); await flush();
    retrieve.mockResolvedValueOnce([]);
    expect(await opts.clientTools.search_document({ query: "troponin" })).toContain("[p. 1]");
  });
  it("captions: user and assistant messages, corrections replace the last assistant caption", async () => {
    await useLiveStore.getState().start(); await flush();
    opts.onMessage({ role: "user", message: "what dose", event_id: 1 });
    opts.onMessage({ role: "agent", message: "Five milligrams nightly, page 2.", event_id: 2 });
    opts.onAgentResponseCorrection({ original_agent_response: "Five milligrams nightly, page 2.", corrected_agent_response: "Five milligrams" });
    expect(useLiveStore.getState().captions).toEqual([{ role: "you", text: "what dose" }, { role: "assistant", text: "Five milligrams" }]);
  });
  it("end: closes, reports usage with elapsed seconds, updates remaining, keeps captions", async () => {
    await useLiveStore.getState().start(); await flush();
    opts.onMessage({ role: "user", message: "hi", event_id: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    await useLiveStore.getState().end(); await flush();
    expect(conv.ended).toBe(true);
    expect(client.reportLiveUsage).toHaveBeenCalledWith("conv_1", 5, false);
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);
    expect(useLiveStore.getState()).toMatchObject({ status: "idle", remainingSeconds: 1705, captions: [{ role: "you", text: "hi" }] });
  });
  it("session cap and silence timer end the session", async () => {
    await useLiveStore.getState().start(); await flush();
    await vi.advanceTimersByTimeAsync(SILENCE_S * 1000 - 1000);
    opts.onMessage({ role: "user", message: "still here", event_id: 1 });   // resets silence
    await vi.advanceTimersByTimeAsync(SILENCE_S * 1000 - 1000);
    expect(useLiveStore.getState().status).toBe("live");
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(useLiveStore.getState().status).toBe("idle");
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);

    client.reportLiveUsage.mockClear();
    await useLiveStore.getState().start(); await flush();
    for (let t = 0; t < SESSION_CAP_S; t += 60) { opts.onInterruption?.(); await vi.advanceTimersByTimeAsync(60_000); }
    await flush();
    expect(useLiveStore.getState().status).toBe("idle");
    expect(client.reportLiveUsage).toHaveBeenCalledWith("conv_1", SESSION_CAP_S, false);
  });
  it("remote disconnect with error shows Connection lost and reports usage once", async () => {
    await useLiveStore.getState().start(); await flush();
    await vi.advanceTimersByTimeAsync(3000);
    opts.onDisconnect({ reason: "error", message: "ice failed", context: { type: "x" } }); await flush();
    expect(useLiveStore.getState()).toMatchObject({ status: "error", error: "Connection lost" });
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);
    expect(client.reportLiveUsage).toHaveBeenCalledWith("conv_1", 3, false);
  });
  it("disconnect before connect shows Connection lost and reports once", async () => {
    configureLiveDeps({ startSession: async (o) => { opts = o; queueMicrotask(() => opts.onDisconnect({ reason: "error", message: "ice failed", context: { type: "x" } })); return conv; } });
    await useLiveStore.getState().start(); await flush();
    expect(useLiveStore.getState()).toMatchObject({ status: "error", error: "Connection lost" });
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);
  });
  it("reports a session cancelled while /live was still pending, once, with 0 seconds", async () => {
    let resolveSession: (v: unknown) => void = () => {};
    client.createLiveSession.mockImplementationOnce(() => new Promise((r) => { resolveSession = r; }));
    const p = useLiveStore.getState().start();
    await flush();
    await useLiveStore.getState().end(); await flush();
    resolveSession({ conversationId: "conv_late", token: "tok", remainingSeconds: 1200, resetAt: 0 });
    await flush(); await p; await flush();
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);
    expect(client.reportLiveUsage).toHaveBeenCalledWith("conv_late", 0);
  });
  it("document change while connecting closes the session once it connects", async () => {
    let resolveStart: () => void = () => {};
    configureLiveDeps({ startSession: (o) => { opts = o; return new Promise((r) => { resolveStart = () => r(conv); }); } });
    const p = useLiveStore.getState().start();
    await flush();
    expect(client.createLiveSession).toHaveBeenCalledTimes(1);
    expect(useLiveStore.getState().status).toBe("connecting");
    openDoc("s2"); await flush();
    expect(conv.ended).toBe(false);
    resolveStart(); queueMicrotask(() => opts.onConnect());
    await flush(); await p; await flush();
    expect(conv.ended).toBe(true);
    expect(useLiveStore.getState().status).toBe("idle");
    expect(client.reportLiveUsage).toHaveBeenCalledTimes(1);
  });
  it("agent-initiated close shows Session ended", async () => {
    await useLiveStore.getState().start(); await flush();
    opts.onDisconnect({ reason: "agent" }); await flush();
    expect(useLiveStore.getState()).toMatchObject({ status: "idle", error: "Session ended" });
  });
  it("document change while live ends the session", async () => {
    await useLiveStore.getState().start(); await flush();
    openDoc("s2"); await flush();
    expect(conv.ended).toBe(true);
    await flush();
    expect(useLiveStore.getState().status).toBe("idle");
  });
  it("setMuted forwards to the client", async () => {
    const spy = vi.spyOn(conv, "setMicMuted");
    await useLiveStore.getState().start(); await flush();
    useLiveStore.getState().setMuted(true);
    expect(spy).toHaveBeenCalledWith(true);
    expect(useLiveStore.getState().muted).toBe(true);
  });
});
