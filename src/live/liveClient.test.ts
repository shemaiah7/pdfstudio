// src/live/liveClient.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { LiveClient, type LiveEvents, type LiveConversation, type StartSession } from "./liveClient";

type Opts = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function fakeSdk(behaviour: { connect?: boolean; disconnectOnEnd?: boolean; throwOnStart?: Error } = {}) {
  let opts: Opts = {};
  const conv: LiveConversation & { ended: boolean; context: string[]; muted: boolean | null } = {
    ended: false, context: [], muted: null,
    async endSession() { this.ended = true; if (behaviour.disconnectOnEnd !== false) opts.onDisconnect?.({ reason: "user" }); },
    sendContextualUpdate(t) { this.context.push(t); },
    setMicMuted(m) { this.muted = m; },
    getId: () => "conv_1",
  };
  const startSession: StartSession = async (o) => {
    opts = o;
    if (behaviour.throwOnStart) throw behaviour.throwOnStart;
    if (behaviour.connect !== false) queueMicrotask(() => opts.onConnect?.());
    return conv;
  };
  return { startSession, conv, opts: () => opts };
}
const transport = { createSession: async () => ({ conversationId: "conv_1", token: "tok", remainingSeconds: 1200, resetAt: 0 }) };
const events = (): LiveEvents & Record<string, ReturnType<typeof vi.fn>> => ({ onConnected: vi.fn(), onUserText: vi.fn(), onAgentText: vi.fn(), onAgentCorrection: vi.fn(), onInterruption: vi.fn(), onError: vi.fn(), onDisconnected: vi.fn() });

describe("LiveClient", () => {
  it("starts with the token over WebRTC, registers the tool, resolves on connect", async () => {
    const sdk = fakeSdk(); const ev = events();
    const search = vi.fn(async (q: string) => `[p. 1] ${q}`);
    const c = new LiveClient(transport, ev, search, { startSession: sdk.startSession });
    const r = await c.start();
    expect(r).toEqual({ remainingSeconds: 1200 });
    expect(sdk.opts()).toMatchObject({ conversationToken: "tok", connectionType: "webrtc" });
    expect(c.conversationId).toBe("conv_1");
    expect(ev.onConnected).toHaveBeenCalledTimes(1);
    expect(await sdk.opts().clientTools.search_document({ query: "warfarin" })).toBe("[p. 1] warfarin");
    expect(search).toHaveBeenCalledWith("warfarin");
  });
  it("routes messages by role and forwards corrections and interruptions", async () => {
    const sdk = fakeSdk(); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession });
    await c.start();
    sdk.opts().onMessage({ role: "user", source: "user", message: "hello", event_id: 1 });
    sdk.opts().onMessage({ role: "agent", source: "ai", message: "hi there", event_id: 2 });
    sdk.opts().onAgentResponseCorrection({ original_agent_response: "hi there", corrected_agent_response: "hi" });
    sdk.opts().onInterruption({ event_id: 3 });
    expect(ev.onUserText).toHaveBeenCalledWith("hello");
    expect(ev.onAgentText).toHaveBeenCalledWith("hi there");
    expect(ev.onAgentCorrection).toHaveBeenCalledWith("hi");
    expect(ev.onInterruption).toHaveBeenCalledTimes(1);
  });
  it("forwards context, mute and error", async () => {
    const sdk = fakeSdk(); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession });
    await c.start();
    c.sendContext("Document: x"); c.mute(true);
    expect(sdk.conv.context).toEqual(["Document: x"]); expect(sdk.conv.muted).toBe(true);
    sdk.opts().onError("boom");
    expect(ev.onError).toHaveBeenCalledWith("boom");
  });
  it("close ends the session and resolves on disconnect; disconnect maps reasons", async () => {
    const sdk = fakeSdk(); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession });
    await c.start();
    await c.close();
    expect(sdk.conv.ended).toBe(true);
    expect(ev.onDisconnected).toHaveBeenCalledWith("user", undefined);
    sdk.opts().onDisconnect({ reason: "error", message: "lost", context: { type: "x" } });
    expect(ev.onDisconnected).toHaveBeenLastCalledWith("error", "lost");
  });
  it("close resolves after the timeout when no disconnect arrives", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk({ disconnectOnEnd: false }); const ev = events();
    const c = new LiveClient(transport, ev, async () => "", { startSession: sdk.startSession, closeTimeoutMs: 50 });
    await c.start();
    const p = c.close();
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(sdk.conv.ended).toBe(true);
    vi.useRealTimers();
  });
  it("start rejects when the SDK throws (mic denied) and when connect times out", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    await expect(new LiveClient(transport, events(), async () => "", { startSession: fakeSdk({ throwOnStart: denied }).startSession }).start()).rejects.toMatchObject({ name: "NotAllowedError" });
    vi.useFakeTimers();
    const sdk = fakeSdk({ connect: false });
    const p = new LiveClient(transport, events(), async () => "", { startSession: sdk.startSession, connectTimeoutMs: 100 }).start();
    const assertion = expect(p).rejects.toThrow("connect_timeout");
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(sdk.conv.ended).toBe(true);
    vi.useRealTimers();
  });
  it("the tool never throws: errors and slow searches become the no-match string", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk();
    const slow = () => new Promise<string>(() => {});
    const c = new LiveClient(transport, events(), slow, { startSession: sdk.startSession });
    await c.start();
    const p = sdk.opts().clientTools.search_document({ query: "x" });
    await vi.advanceTimersByTimeAsync(8_100);
    expect(await p).toBe("No passage in the document matched that query.");
    vi.useRealTimers();
    const c2 = new LiveClient(transport, events(), async () => { throw new Error("bad"); }, { startSession: sdk.startSession });
    await c2.start();
    expect(await sdk.opts().clientTools.search_document({ query: "x" })).toBe("No passage in the document matched that query.");
    expect(await sdk.opts().clientTools.search_document({})).toBe("No passage in the document matched that query.");
  });
  it("fails fast with the disconnect cause when the session dies before connecting", async () => {
    const sdk = fakeSdk({ connect: false });
    const base = sdk.startSession;
    const startSession: StartSession = async (o) => { const c = await base(o); (o as Opts).onDisconnect({ reason: "error", message: "ice failed", context: { type: "x" } }); return c; };
    const c = new LiveClient(transport, events(), async () => "", { startSession });
    await expect(c.start()).rejects.toThrow("ice failed");
    expect(sdk.conv.ended).toBe(true);
  });
  it("is single-use: a second start rejects without calling the transport", async () => {
    const sdk = fakeSdk();
    const createSession = vi.fn(transport.createSession);
    const c = new LiveClient({ createSession }, events(), async () => "", { startSession: sdk.startSession });
    await c.start();
    await expect(c.start()).rejects.toThrow("already_started");
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
