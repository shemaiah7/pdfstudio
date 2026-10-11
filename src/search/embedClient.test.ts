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
});
