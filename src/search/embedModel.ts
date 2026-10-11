import { AutoConfig, AutoModel, AutoTokenizer } from "@huggingface/transformers";
import { DIMS, DOC_PREFIX, EMBED_BATCH, MODEL_ID, QUERY_PREFIX } from "./constants";
import { truncateNormalize } from "./ranker";

export type EmbedDevice = "webgpu" | "wasm" | "cpu";
export type ProgressInfo = { status: string; file?: string; loaded?: number; total?: number };
export interface EmbedModel {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
}

// The browser WASM build of onnxruntime-web lacks GatherBlockQuantized (used by the q4 embedding table), so wasm uses fp32.
// Text-only: dropping vision/audio configs keeps those encoders (~300 MB) from being downloaded.
export async function loadEmbedModel(device: EmbedDevice, progress_callback?: (p: ProgressInfo) => void): Promise<EmbedModel> {
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
  const config = await AutoConfig.from_pretrained(MODEL_ID, { progress_callback });
  (config as unknown as Record<string, unknown>).vision_config = null;
  (config as unknown as Record<string, unknown>).audio_config = null;
  const model = await AutoModel.from_pretrained(MODEL_ID, { config, dtype: device === "wasm" ? "fp32" : "q4", device, progress_callback });
  return { tokenizer, model };
}

export async function embedTexts(m: EmbedModel, texts: string[], kind: "query" | "document"): Promise<Float32Array> {
  const prefix = kind === "query" ? QUERY_PREFIX : DOC_PREFIX;
  const out = new Float32Array(texts.length * DIMS);
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => prefix + t);
    const inputs = m.tokenizer(batch, { padding: true, truncation: true });
    const result = (await m.model(inputs)) as { sentence_embedding: { dims: number[]; data: Float32Array; dispose?: () => void } };
    const emb = result.sentence_embedding;
    const width = emb.dims[emb.dims.length - 1];
    for (let r = 0; r < batch.length; r++) out.set(truncateNormalize(emb.data.subarray(r * width, (r + 1) * width)), (i + r) * DIMS);
    for (const t of Object.values(result) as { dispose?: () => void }[]) t.dispose?.();
  }
  return out;
}

export async function disposeEmbedModel(m: EmbedModel): Promise<void> {
  await (m.model as unknown as { dispose?: () => Promise<void> }).dispose?.();
}
