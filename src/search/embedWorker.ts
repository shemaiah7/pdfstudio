/// <reference lib="webworker" />
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { DIMS, DOC_PREFIX, EMBED_BATCH, MODEL_ID, QUERY_PREFIX } from "./constants";
import { truncateNormalize } from "./ranker";
import type { WorkerIn, WorkerOut } from "./embedClient";

let extractor: FeatureExtractionPipeline | null = null;
const post = (m: WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

async function load(): Promise<"webgpu" | "wasm"> {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: "progress", loaded, total });
  };
  for (const device of ["webgpu", "wasm"] as const) {
    try {
      extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q4", device, progress_callback });
      return device;
    } catch (err) {
      if (device === "wasm") throw err;
    }
  }
  throw new Error("unreachable");
}

async function embed(texts: string[], kind: "query" | "document"): Promise<Float32Array> {
  if (!extractor) throw new Error("not loaded");
  const prefix = kind === "query" ? QUERY_PREFIX : DOC_PREFIX;
  const out = new Float32Array(texts.length * DIMS);
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => prefix + t);
    const result = await extractor(batch, { pooling: "mean", normalize: true });
    const dims = result.dims as number[];
    const width = dims[dims.length - 1];
    const data = result.data as Float32Array;
    for (let r = 0; r < batch.length; r++) out.set(truncateNormalize(data.subarray(r * width, (r + 1) * width)), (i + r) * DIMS);
    result.dispose?.();
  }
  return out;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  try {
    if (m.type === "load") post({ type: "ready", device: await load() });
    else if (m.type === "embed") { const vectors = await embed(m.texts, m.kind); post({ type: "embedded", id: m.id, vectors }, [vectors.buffer]); }
    else if (m.type === "dispose") { await extractor?.dispose(); extractor = null; }
  } catch (err) {
    post({ type: "error", ...(m.type === "embed" ? { id: m.id } : {}), message: err instanceof Error ? err.message : String(err) });
  }
};
