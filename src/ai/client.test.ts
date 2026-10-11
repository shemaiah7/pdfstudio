// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { AiClient } from "./client";

function sse(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/event-stream", ...headers } });
}
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AiClient", () => {
  it("gets a session once and streams deltas and done", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ token: "t1", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(sse('event: delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {"usage":{"input":1,"output":1},"stop":"end_turn","remaining":{"requests":19,"tokens":1},"resetAt":1}\n\n'));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn });
    const deltas: string[] = []; let done: unknown = null;
    await c.runTask({ task: "summarize", document: [{ page: 1, text: "x" }] }, { onDelta: (t) => deltas.push(t), onDone: (d) => (done = d), onError: () => {} }).done;
    expect(deltas).toEqual(["Hi"]);
    expect(done).toMatchObject({ stop: "end_turn" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[1][1] as RequestInit).headers).toMatchObject({ authorization: "Bearer t1" });
  });

  it("re-runs the session once on 401 then retries", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ token: "old", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(json({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(json({ token: "new", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(sse('event: done\ndata: {"usage":{"input":0,"output":0},"stop":"end_turn","remaining":{"requests":1,"tokens":1},"resetAt":1}\n\n'));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn });
    let done = false;
    await c.runTask({ task: "summarize", document: [{ page: 1, text: "x" }] }, { onDelta: () => {}, onDone: () => (done = true), onError: () => {} }).done;
    expect(done).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("maps 429 daily_limit to onError with resetAt", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ token: "t", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(json({ error: "daily_limit", resetAt: 123 }, 429));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn });
    const onError = vi.fn();
    await c.runTask({ task: "summarize", document: [{ page: 1, text: "x" }] }, { onDelta: () => {}, onDone: () => {}, onError }).done;
    expect(onError).toHaveBeenCalledWith("daily_limit", { resetAt: 123 });
  });

  it("reports interrupted when the stream ends without done", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ token: "t", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(sse('event: delta\ndata: {"text":"par"}\n\n'));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn });
    const onError = vi.fn();
    await c.runTask({ task: "summarize", document: [{ page: 1, text: "x" }] }, { onDelta: () => {}, onDone: () => {}, onError }).done;
    expect(onError).toHaveBeenCalledWith("interrupted", undefined);
  });

  it("concurrent runTask calls share one session", async () => {
    const doneBody = 'event: done\ndata: {"usage":{"input":0,"output":0},"stop":"end_turn","remaining":{"requests":1,"tokens":1},"resetAt":1}\n\n';
    const fetchFn = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/session") ? json({ token: "t", expiresAt: 9e9 }, 200) : sse(doneBody));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn: fetchFn as never });
    const h = { onDelta: () => {}, onDone: () => {}, onError: () => {} };
    const req = { task: "summarize" as const, document: [{ page: 1, text: "x" }] };
    await Promise.all([c.runTask(req, h).done, c.runTask(req, h).done]);
    expect(fetchFn.mock.calls.filter((x) => String(x[0]).endsWith("/session"))).toHaveLength(1);
  });

  it("reports upstream once and stops on a malformed data frame", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ token: "t", expiresAt: 9e9 }, 200))
      .mockResolvedValueOnce(sse('event: delta\ndata: {not json}\n\nevent: delta\ndata: {"text":"late"}\n\nevent: done\ndata: {"usage":{"input":0,"output":0},"stop":"end_turn","remaining":{"requests":1,"tokens":1},"resetAt":1}\n\n'));
    const c = new AiClient({ baseUrl: "https://ai.test", getTurnstileToken: async () => "tok", fetchFn });
    const onError = vi.fn(); const onDelta = vi.fn(); const onDone = vi.fn();
    await c.runTask({ task: "summarize", document: [{ page: 1, text: "x" }] }, { onDelta, onDone, onError }).done;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("upstream");
    expect(onDelta).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("AiClient.runOcr", () => {
  it("runOcr posts the pages with the session token and returns the JSON", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const client = new AiClient({ baseUrl: "https://ai.example", getTurnstileToken: async () => "ts", fetchFn: async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/session")) return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
      return new Response(JSON.stringify({ pages: [{ page: 1, lines: ["a"] }], failed: [], remaining: { requests: 1, tokens: 1 }, resetAt: 0 }), { status: 200 });
    } });
    const r = await client.runOcr([{ page: 1, image: "abc" }]);
    expect(r.pages[0].lines).toEqual(["a"]);
    expect(calls[1]).toEqual({ url: "https://ai.example/ocr", body: { task: "ocr", pages: [{ page: 1, image: "abc" }] } });
  });
  it("runOcr throws the worker's error code", async () => {
    const client = new AiClient({ baseUrl: "https://ai.example", getTurnstileToken: async () => "ts", fetchFn: async (input) =>
      String(input).endsWith("/session") ? new Response(JSON.stringify({ token: "tok" })) : new Response(JSON.stringify({ error: "daily_limit", resetAt: 5 }), { status: 429 }) });
    await expect(client.runOcr([{ page: 1, image: "abc" }])).rejects.toMatchObject({ message: "daily_limit", resetAt: 5 });
  });
});
