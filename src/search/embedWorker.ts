/// <reference lib="webworker" />
import { disposeEmbedModel, embedTexts, loadEmbedModel, type EmbedModel, type ProgressInfo } from "./embedModel";
import type { WorkerIn, WorkerOut } from "./embedClient";

let model: EmbedModel | null = null;
let device: "webgpu" | "wasm" | null = null;
const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

async function hasGpuAdapter(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch { return false; }
}

// onnxruntime-web chains session creation in a module-level promise (transformers.js backends/onnx.js
// webInitChain); once a WebGPU attempt rejects, every later attempt in this worker re-throws that same
// error, so a WASM fallback in the same worker can never succeed. Skip WebGPU when there is no adapter,
// and otherwise report a failed WebGPU attempt with retry:"wasm" so the client restarts a fresh worker.
class WebGpuFailed extends Error {}

async function load(want?: "wasm"): Promise<"webgpu" | "wasm"> {
  if (model && device) return device;
  const files = new Map<string, { loaded: number; total: number }>();
  let maxTotal = 0;
  const progress_callback = (p: ProgressInfo) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += Math.max(f.total, f.loaded); }
    maxTotal = Math.max(maxTotal, total);
    post({ type: "progress", loaded: Math.min(loaded, maxTotal), total: maxTotal });
  };
  if (want !== "wasm" && (await hasGpuAdapter())) {
    try {
      const m = await loadEmbedModel("webgpu", progress_callback);
      try { await embedTexts(m, ["warm up"], "query"); }
      catch (err) { await disposeEmbedModel(m).catch(() => {}); throw err; }
      model = m; device = "webgpu";
      return "webgpu";
    } catch (err) {
      throw new WebGpuFailed(err instanceof Error ? err.message : String(err));
    }
  }
  model = await loadEmbedModel("wasm", progress_callback);
  device = "wasm";
  return "wasm";
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  try {
    if (m.type === "load") post({ type: "ready", device: await load(m.device) });
    else if (m.type === "embed") {
      if (!model) throw new Error("not loaded");
      const vectors = await embedTexts(model, m.texts, m.kind);
      post({ type: "embedded", id: m.id, vectors }, [vectors.buffer]);
    } else if (m.type === "dispose") { if (model) await disposeEmbedModel(model); model = null; device = null; }
  } catch (err) {
    post({ type: "error", ...(m.type === "embed" ? { id: m.id } : {}), ...(err instanceof WebGpuFailed ? { retry: "wasm" as const } : {}), message: err instanceof Error ? err.message : String(err) });
  }
};
