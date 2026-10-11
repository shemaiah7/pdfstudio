/// <reference lib="webworker" />
import { disposeEmbedModel, embedTexts, loadEmbedModel, type EmbedModel, type ProgressInfo } from "./embedModel";
import type { WorkerIn, WorkerOut } from "./embedClient";

let model: EmbedModel | null = null;
let device: "webgpu" | "wasm" | null = null;
const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

async function load(): Promise<"webgpu" | "wasm"> {
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
  for (const d of ["webgpu", "wasm"] as const) {
    try {
      const m = await loadEmbedModel(d, progress_callback);
      if (d === "webgpu") {
        try { await embedTexts(m, ["warm up"], "query"); }
        catch (err) { await disposeEmbedModel(m).catch(() => {}); throw err; }
      }
      model = m; device = d;
      return d;
    } catch (err) {
      if (d === "wasm") throw err;
    }
  }
  throw new Error("unreachable");
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  try {
    if (m.type === "load") post({ type: "ready", device: await load() });
    else if (m.type === "embed") {
      if (!model) throw new Error("not loaded");
      const vectors = await embedTexts(model, m.texts, m.kind);
      post({ type: "embedded", id: m.id, vectors }, [vectors.buffer]);
    } else if (m.type === "dispose") { if (model) await disposeEmbedModel(model); model = null; device = null; }
  } catch (err) {
    post({ type: "error", ...(m.type === "embed" ? { id: m.id } : {}), message: err instanceof Error ? err.message : String(err) });
  }
};
