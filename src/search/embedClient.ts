import { DIMS } from "./constants";

export type WorkerIn =
  | { type: "load" }
  | { type: "embed"; id: number; texts: string[]; kind: "query" | "document" }
  | { type: "dispose" };
export type WorkerOut =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "embedded"; id: number; vectors: Float32Array }
  | { type: "error"; id?: number; message: string };

interface Job { id: number; texts: string[]; kind: "query" | "document"; tag?: string; resolve(v: Float32Array): void; reject(e: Error): void; sent: boolean }

export class EmbedClient {
  private worker: Worker | null = null;
  private jobs: Job[] = [];
  private nextId = 1;
  private loading: { resolve(d: "webgpu" | "wasm"): void; reject(e: Error): void; onProgress(l: number, t: number): void } | null = null;
  private makeWorker: () => Worker;
  constructor(makeWorker: () => Worker) { this.makeWorker = makeWorker; }

  load(onProgress: (loaded: number, total: number) => void): Promise<"webgpu" | "wasm"> {
    this.worker ??= this.attach(this.makeWorker());
    return new Promise((resolve, reject) => { this.loading = { resolve, reject, onProgress }; this.worker!.postMessage({ type: "load" } satisfies WorkerIn); });
  }
  embed(texts: string[], kind: "query" | "document", tag?: string): Promise<Float32Array> {
    if (!this.worker) return Promise.reject(new Error("not loaded"));
    return new Promise((resolve, reject) => { this.jobs.push({ id: this.nextId++, texts, kind, tag, resolve, reject, sent: false }); this.pump(); });
  }
  cancel(tag: string) {
    const keep: Job[] = [];
    for (const j of this.jobs) { if (j.tag === tag && !j.sent) j.reject(new Error("cancelled")); else keep.push(j); }
    this.jobs = keep;
  }
  dispose() {
    for (const j of this.jobs) j.reject(new Error("disposed"));
    this.jobs = [];
    this.worker?.postMessage({ type: "dispose" } satisfies WorkerIn);
    this.worker?.terminate();
    this.worker = null;
  }
  private pump() {
    const head = this.jobs[0];
    if (!head || head.sent) return;
    head.sent = true;
    this.worker!.postMessage({ type: "embed", id: head.id, texts: head.texts, kind: head.kind } satisfies WorkerIn);
  }
  private attach(w: Worker): Worker {
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "progress") this.loading?.onProgress(m.loaded, m.total);
      else if (m.type === "ready") { this.loading?.resolve(m.device); this.loading = null; }
      else if (m.type === "embedded") { const j = this.jobs.shift(); if (j && j.id === m.id) j.resolve(m.vectors); this.pump(); }
      else if (m.type === "error") {
        if (m.id === undefined && this.loading) { this.loading.reject(new Error(m.message)); this.loading = null; }
        else { const j = this.jobs.shift(); j?.reject(new Error(m.message)); this.pump(); }
      }
    };
    w.onerror = (e) => { this.loading?.reject(new Error(e.message || "worker error")); this.loading = null; };
    return w;
  }
}

let singleton: EmbedClient | null = null;
export function getEmbedClient(): EmbedClient {
  return (singleton ??= new EmbedClient(() => new Worker(new URL("./embedWorker.ts", import.meta.url), { type: "module" })));
}
export const EMBED_DIMS = DIMS;
