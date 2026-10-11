import { DIMS } from "./constants";

export type WorkerIn =
  | { type: "load"; device?: "wasm" }
  | { type: "embed"; id: number; texts: string[]; kind: "query" | "document" }
  | { type: "dispose" };
export type WorkerOut =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "embedded"; id: number; vectors: Float32Array }
  | { type: "error"; id?: number; message: string; retry?: "wasm" };

interface Job { id: number; texts: string[]; kind: "query" | "document"; tag?: string; resolve(v: Float32Array): void; reject(e: Error): void; sent: boolean }

type Device = "webgpu" | "wasm";

export class EmbedClient {
  private worker: Worker | null = null;
  private jobs: Job[] = [];
  private nextId = 1;
  private loadPromise: Promise<Device> | null = null;
  private device: Device | null = null;
  private loading: { resolve(d: Device): void; reject(e: Error): void; onProgress(l: number, t: number): void } | null = null;
  private warned = false;
  private makeWorker: () => Worker;
  constructor(makeWorker: () => Worker) { this.makeWorker = makeWorker; }

  load(onProgress: (loaded: number, total: number) => void): Promise<Device> {
    if (this.loadPromise) return this.loadPromise;
    if (this.device) return Promise.resolve(this.device);
    const worker = (this.worker ??= this.attach(this.makeWorker()));
    const p = new Promise<Device>((resolve, reject) => {
      this.loading = { resolve, reject, onProgress };
      worker.postMessage({ type: "load" } satisfies WorkerIn);
    });
    this.loadPromise = p;
    p.then(
      (d) => { if (this.loadPromise === p) { this.device = d; this.loadPromise = null; } },
      () => { if (this.loadPromise === p) this.loadPromise = null; },
    );
    return p;
  }
  embed(texts: string[], kind: "query" | "document", tag?: string): Promise<Float32Array> {
    const enqueue = () => new Promise<Float32Array>((resolve, reject) => {
      if (!this.worker) { reject(new Error("not loaded")); return; }
      this.jobs.push({ id: this.nextId++, texts, kind, tag, resolve, reject, sent: false });
      this.pump();
    });
    if (this.loadPromise) return this.loadPromise.then(enqueue);
    return enqueue();
  }
  cancel(tag: string) {
    const keep: Job[] = [];
    for (const j of this.jobs) { if (j.tag === tag && !j.sent) j.reject(new Error("cancelled")); else keep.push(j); }
    this.jobs = keep;
  }
  dispose() {
    const err = new Error("disposed");
    this.loading?.reject(err);
    this.loading = null;
    this.loadPromise = null;
    this.device = null;
    for (const j of this.jobs) j.reject(err);
    this.jobs = [];
    this.worker?.postMessage({ type: "dispose" } satisfies WorkerIn);
    this.worker?.terminate();
    this.worker = null;
  }
  private pump() {
    const head = this.jobs[0];
    if (!head || head.sent || !this.worker) return;
    head.sent = true;
    this.worker.postMessage({ type: "embed", id: head.id, texts: head.texts, kind: head.kind } satisfies WorkerIn);
  }
  private stray(id: number | undefined) {
    if (!this.warned) { this.warned = true; console.warn("EmbedClient: ignoring response for unexpected job id", id); }
  }
  private attach(w: Worker): Worker {
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (this.worker !== w) return;
      const m = e.data;
      if (m.type === "progress") this.loading?.onProgress(m.loaded, m.total);
      else if (m.type === "ready") { this.loading?.resolve(m.device); this.loading = null; }
      else if (m.type === "embedded") {
        if (this.jobs[0]?.id !== m.id) { this.stray(m.id); return; }
        this.jobs.shift()!.resolve(m.vectors); this.pump();
      } else if (m.type === "error") {
        if (m.id === undefined && m.retry && this.loading) {
          // onnxruntime-web's init chain is poisoned by a failed WebGPU attempt, so retry on a fresh worker.
          this.worker = null;
          w.terminate();
          this.worker = this.attach(this.makeWorker());
          this.worker.postMessage({ type: "load", device: "wasm" } satisfies WorkerIn);
        } else if (m.id === undefined) { if (this.loading) { this.loading.reject(new Error(m.message)); this.loading = null; } }
        else if (this.jobs[0]?.id !== m.id) this.stray(m.id);
        else { this.jobs.shift()!.reject(new Error(m.message)); this.pump(); }
      }
    };
    w.onerror = (e) => {
      if (this.worker !== w) return;
      const crash = new Error("worker crashed");
      this.loading?.reject(new Error(e.message || "worker crashed"));
      this.loading = null;
      this.loadPromise = null;
      this.device = null;
      for (const j of this.jobs) j.reject(crash);
      this.jobs = [];
      w.terminate();
      this.worker = null;
    };
    return w;
  }
}

let singleton: EmbedClient | null = null;
export function getEmbedClient(): EmbedClient {
  return (singleton ??= new EmbedClient(() => new Worker(new URL("./embedWorker.ts", import.meta.url), { type: "module" })));
}
export const EMBED_DIMS = DIMS;
