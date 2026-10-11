import { describe, it, expect } from "vitest";
import { EmbedClient, type WorkerIn, type WorkerOut } from "./embedClient";
import { DIMS } from "./constants";

class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerOut>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: WorkerIn[] = [];
  terminated = false;
  private script: (msg: WorkerIn, reply: (out: WorkerOut) => void) => void;
  constructor(script: (msg: WorkerIn, reply: (out: WorkerOut) => void) => void) { this.script = script; }
  postMessage(msg: WorkerIn) { this.sent.push(msg); queueMicrotask(() => this.script(msg, (out) => this.onmessage?.({ data: out } as MessageEvent<WorkerOut>))); }
  terminate() { this.terminated = true; }
}

const vectors = (n: number) => { const v = new Float32Array(n * DIMS); for (let i = 0; i < n; i++) v[i * DIMS] = 1; return v; };

describe("EmbedClient", () => {
  it("loads with progress and resolves the device", async () => {
    const w = new FakeWorker((m, r) => { if (m.type === "load") { r({ type: "progress", loaded: 5, total: 10 }); r({ type: "ready", device: "wasm" }); } });
    const c = new EmbedClient(() => w as unknown as Worker);
    const seen: number[] = [];
    expect(await c.load((l) => seen.push(l))).toBe("wasm");
    expect(seen).toEqual([5]);
  });
  it("embeds in order and returns a flat Float32Array", async () => {
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "webgpu" }); if (m.type === "embed") r({ type: "embedded", id: m.id, vectors: vectors(m.texts.length) }); });
    const c = new EmbedClient(() => w as unknown as Worker);
    await c.load(() => {});
    const [a, b] = await Promise.all([c.embed(["x", "y"], "document"), c.embed(["q"], "query")]);
    expect(a.length).toBe(2 * DIMS); expect(b.length).toBe(DIMS);
    expect(w.sent.filter((s) => s.type === "embed").map((s) => (s as { kind: string }).kind)).toEqual(["document", "query"]);
  });
  it("rejects a load error so the caller can show Retry", async () => {
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "error", message: "offline" }); });
    const c = new EmbedClient(() => w as unknown as Worker);
    await expect(c.load(() => {})).rejects.toThrow("offline");
  });
  it("cancel drops queued jobs with the tag", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); if (m.type === "embed") void gate.then(() => r({ type: "embedded", id: m.id, vectors: vectors(m.texts.length) })); });
    const c = new EmbedClient(() => w as unknown as Worker);
    await c.load(() => {});
    const first = c.embed(["a"], "document", "doc1");
    const second = c.embed(["b"], "document", "doc1");
    c.cancel("doc1");
    await expect(second).rejects.toThrow("cancelled");
    release();
    expect((await first).length).toBe(DIMS);
  });
  it("dispose terminates the worker and rejects pending jobs", async () => {
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); });
    const c = new EmbedClient(() => w as unknown as Worker);
    await c.load(() => {});
    const p = c.embed(["a"], "query");
    c.dispose();
    await expect(p).rejects.toThrow("disposed");
    expect(w.terminated).toBe(true);
  });
  it("load caches its promise and resolves immediately once ready", async () => {
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); });
    const c = new EmbedClient(() => w as unknown as Worker);
    const p1 = c.load(() => {}); const p2 = c.load(() => {});
    expect(p2).toBe(p1);
    await p1;
    expect(await c.load(() => {})).toBe("wasm");
    expect(w.sent.filter((s) => s.type === "load").length).toBe(1);
  });
  it("embed before ready waits for load, and rejects if load failed", async () => {
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); if (m.type === "embed") r({ type: "embedded", id: m.id, vectors: vectors(1) }); });
    const c = new EmbedClient(() => w as unknown as Worker);
    void c.load(() => {});
    expect((await c.embed(["a"], "query")).length).toBe(DIMS);
    const w2 = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "error", message: "offline" }); });
    const c2 = new EmbedClient(() => w2 as unknown as Worker);
    const lp = c2.load(() => {}); lp.catch(() => {});
    await expect(c2.embed(["a"], "query")).rejects.toThrow("offline");
  });
  it("ignores responses whose id is not the head job", async () => {
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); if (m.type === "embed") { r({ type: "embedded", id: 999, vectors: vectors(1) }); r({ type: "error", id: 998, message: "stray" }); r({ type: "embedded", id: m.id, vectors: vectors(1) }); } });
    const c = new EmbedClient(() => w as unknown as Worker);
    await c.load(() => {});
    expect((await c.embed(["a"], "query")).length).toBe(DIMS);
  });
  it("worker crash rejects in-flight and queued jobs, then a fresh worker is created on load", async () => {
    const workers: FakeWorker[] = [];
    const make = () => { const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); }); workers.push(w); return w as unknown as Worker; };
    const c = new EmbedClient(make);
    await c.load(() => {});
    const a = c.embed(["a"], "query"); const b = c.embed(["b"], "query");
    workers[0].onerror?.({ message: "boom" } as ErrorEvent);
    await expect(a).rejects.toThrow("worker crashed");
    await expect(b).rejects.toThrow("worker crashed");
    expect(workers[0].terminated).toBe(true);
    await c.load(() => {});
    expect(workers.length).toBe(2);
  });
  it("dispose rejects a pending load", async () => {
    const w = new FakeWorker(() => {});
    const c = new EmbedClient(() => w as unknown as Worker);
    const p = c.load(() => {});
    c.dispose();
    await expect(p).rejects.toThrow("disposed");
  });
  it("keeps one job in flight; a per-job error rejects only that job", async () => {
    const pending: Array<(o: WorkerOut) => void> = [];
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); if (m.type === "embed") pending.push(r); });
    const c = new EmbedClient(() => w as unknown as Worker);
    await c.load(() => {});
    const a = c.embed(["a"], "query"); const b = c.embed(["b"], "query");
    await Promise.resolve(); await Promise.resolve();
    expect(w.sent.filter((s) => s.type === "embed").length).toBe(1);
    const firstId = (w.sent.find((s) => s.type === "embed") as { id: number }).id;
    pending[0]({ type: "error", id: firstId, message: "bad" });
    await expect(a).rejects.toThrow("bad");
    await Promise.resolve(); await Promise.resolve();
    expect(w.sent.filter((s) => s.type === "embed").length).toBe(2);
    pending[1]({ type: "embedded", id: firstId + 1, vectors: vectors(1) });
    expect((await b).length).toBe(DIMS);
  });
  it("cancel never posts the cancelled job, keeps other tags, and the queue continues", async () => {
    const pending: Array<(o: WorkerOut) => void> = [];
    const w = new FakeWorker((m, r) => { if (m.type === "load") r({ type: "ready", device: "wasm" }); if (m.type === "embed") pending.push(r); });
    const c = new EmbedClient(() => w as unknown as Worker);
    await c.load(() => {});
    const first = c.embed(["a"], "document", "t1");
    const dropped = c.embed(["b"], "document", "t2");
    const kept = c.embed(["c"], "document", "t3");
    c.cancel("t2");
    await expect(dropped).rejects.toThrow("cancelled");
    await Promise.resolve(); await Promise.resolve();
    pending[0]({ type: "embedded", id: 1, vectors: vectors(1) });
    await first;
    await Promise.resolve(); await Promise.resolve();
    const embeds = w.sent.filter((s) => s.type === "embed") as { texts: string[] }[];
    expect(embeds.map((e) => e.texts[0])).toEqual(["a", "c"]);
    pending[1]({ type: "embedded", id: 3, vectors: vectors(1) });
    expect((await kept).length).toBe(DIMS);
  });
});
