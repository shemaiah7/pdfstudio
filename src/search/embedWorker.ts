/// <reference lib="webworker" />
import { disposeEmbedModel, embedTexts, loadEmbedModel, type EmbedModel, type ProgressInfo } from "./embedModel";
import { env } from "@huggingface/transformers";
import { cdnWasmPaths, ORT_VERSION } from "./constants";
import type { WorkerIn, WorkerOut } from "./embedClient";

// Production builds drop the ONNX runtime binaries (over the 25 MiB asset cap); fetch them from the CDN. Dev uses local files.
if (import.meta.env.PROD) env.backends.onnx.wasm!.wasmPaths = cdnWasmPaths(ORT_VERSION);

let model: EmbedModel | null = null;
let device: "webgpu" | "wasm" | null = null;
const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

async function hasGpuAdapter(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch { return false; }
}

// onnxruntime-web chains session creation in a module-level promise; once an attempt rejects, every later
// attempt in that worker re-throws the same error, so a failed load is never retried in-process (the client
// discards the worker). WebGPU is required unless the user explicitly asks for CPU (wasm) mode, because the
// browser wasm build cannot run the q4 model and needs the ~1 GB fp32 weights.
class CodedError extends Error { code: "no-webgpu"; constructor(code: "no-webgpu", message: string) { super(message); this.code = code; } }

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
  if (want === "wasm") {
    model = await loadEmbedModel("wasm", progress_callback);
    device = "wasm";
    return "wasm";
  }
  if (!(await hasGpuAdapter())) throw new CodedError("no-webgpu", "WebGPU is not available");
  const m = await loadEmbedModel("webgpu", progress_callback);
  try { await embedTexts(m, ["warm up"], "query"); }
  catch (err) { await disposeEmbedModel(m).catch(() => {}); throw err; }
  model = m; device = "webgpu";
  return "webgpu";
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  try {
    if (m.type === "load") { const d = await load(m.device); post({ type: "ready", device: d, dtype: d === "wasm" ? "fp32" : "q4" }); }
    else if (m.type === "embed") {
      if (!model) throw new Error("not loaded");
      const vectors = await embedTexts(model, m.texts, m.kind);
      post({ type: "embedded", id: m.id, vectors }, [vectors.buffer]);
    } else if (m.type === "dispose") { if (model) await disposeEmbedModel(model); model = null; device = null; }
  } catch (err) {
    post({ type: "error", ...(m.type === "embed" ? { id: m.id } : {}), ...(err instanceof CodedError ? { code: err.code } : {}), message: err instanceof Error ? err.message : String(err) });
  }
};
