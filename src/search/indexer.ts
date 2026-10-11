import type { SourceFile } from "../pdf/types";
import { extractPageText } from "../pdf/text";
import { chunkPage, type Chunk } from "./chunker";
import { DIMS, EMBED_BATCH, MODEL_TAG } from "./constants";
import { library, sha256, type Library } from "./library";
import { getEmbedClient } from "./embedClient";

export interface IndexDeps {
  embed: (texts: string[], kind: "document", tag: string) => Promise<Float32Array>;
  lib: Library;
  extract: (source: SourceFile, page: number) => Promise<string>;
}
export type IndexResult =
  | { status: "cached" | "indexed" | "no-text"; hash: string; chunks: number }
  | { status: "cancelled"; hash: string }
  | { status: "failed"; hash: string; message: string };

export function defaultDeps(): IndexDeps {
  return {
    embed: (texts, kind, tag) => getEmbedClient().embed(texts, kind, tag),
    lib: library,
    extract: async (source, page) => (await extractPageText(source, page)).text,
  };
}

export async function indexSource(source: SourceFile, deps: IndexDeps = defaultDeps(), onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<IndexResult> {
  let hash = "";
  try {
    hash = await sha256(source.bytes);
    const existing = await deps.lib.get(hash);
    if (existing) return { status: "cached", hash, chunks: existing.chunks.length };
    const chunks: Chunk[] = [];
    for (let p = 0; p < source.pageCount; p++) {
      if (signal?.aborted) return { status: "cancelled", hash };
      chunks.push(...chunkPage(p, await deps.extract(source, p)));
      onProgress?.(p + 1, source.pageCount);
    }
    const vectors = new Float32Array(chunks.length * DIMS);
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      if (signal?.aborted) return { status: "cancelled", hash };
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const result = await deps.embed(batch.map((c) => c.text), "document", hash);
      if (result.length !== batch.length * DIMS) throw new Error(`embedding returned ${result.length} values, expected ${batch.length * DIMS}`);
      vectors.set(result, i * DIMS);
    }
    if (signal?.aborted) return { status: "cancelled", hash };
    await deps.lib.put({ hash, name: source.name, size: source.bytes.byteLength, pageCount: source.pageCount, addedAt: Date.now(), modelId: MODEL_TAG, bytes: new Blob([source.bytes as BlobPart]), chunks, vectors });
    return { status: chunks.length === 0 ? "no-text" : "indexed", hash, chunks: chunks.length };
  } catch (err) {
    if (err instanceof Error && (err.message === "cancelled" || err.message === "disposed")) return { status: "cancelled", hash };
    return { status: "failed", hash, message: err instanceof Error ? err.message : String(err) };
  }
}
