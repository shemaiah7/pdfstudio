import { openDB, type IDBPDatabase } from "idb";
import type { Chunk } from "./chunker";
import type { RankDoc } from "./ranker";
import { MODEL_TAG } from "./constants";

export interface LibraryRecord {
  hash: string; name: string; size: number; pageCount: number; addedAt: number; modelId: string;
  bytes: Blob; chunks: Chunk[]; vectors: Float32Array;
}
export interface LibrarySummary { hash: string; name: string; size: number; pageCount: number; addedAt: number; modelId: string; chunkCount: number; stale: boolean }

const STORE = "documents";

export async function sha256(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Opener = () => Promise<IDBPDatabase>;

export function createLibrary(dbName = "pdfstudio-search", open?: Opener) {
  const memory = new Map<string, LibraryRecord>();
  let db: Promise<IDBPDatabase> | null = null;
  const state = { persistent: true };
  const opener: Opener = open ?? (() => openDB(dbName, 1, { upgrade(d) { d.createObjectStore(STORE, { keyPath: "hash" }); } }));
  const getDb = async (): Promise<IDBPDatabase | null> => {
    if (!state.persistent) return null;
    try { return await (db ??= Promise.resolve().then(opener)); }
    catch { state.persistent = false; db = null; return null; }
  };
  const summary = (r: LibraryRecord): LibrarySummary => ({ hash: r.hash, name: r.name, size: r.size, pageCount: r.pageCount, addedAt: r.addedAt, modelId: r.modelId, chunkCount: r.chunks.length, stale: r.modelId !== MODEL_TAG });
  const revive = (r: LibraryRecord): LibraryRecord => ({ ...r, vectors: r.vectors instanceof Float32Array ? r.vectors : new Float32Array(r.vectors as unknown as ArrayLike<number>) });

  return {
    get persistent() { return state.persistent; },
    async put(record: LibraryRecord) {
      const d = await getDb();
      if (d) { try { await d.put(STORE, record); return; } catch { state.persistent = false; } }
      memory.set(record.hash, record);
    },
    async get(hash: string): Promise<LibraryRecord | undefined> {
      const d = await getDb();
      const r = d ? ((await d.get(STORE, hash)) as LibraryRecord | undefined) : memory.get(hash);
      return r && r.modelId === MODEL_TAG ? revive(r) : undefined;
    },
    async list(): Promise<LibrarySummary[]> {
      const d = await getDb();
      const all = d ? ((await d.getAll(STORE)) as LibraryRecord[]) : [...memory.values()];
      return all.map(summary).sort((a, b) => b.addedAt - a.addedAt);
    },
    async loadAll(): Promise<RankDoc[]> {
      const d = await getDb();
      const all = d ? ((await d.getAll(STORE)) as LibraryRecord[]) : [...memory.values()];
      return all.filter((r) => r.modelId === MODEL_TAG).map(revive).map((r) => ({ hash: r.hash, chunks: r.chunks, vectors: r.vectors }));
    },
    async remove(hash: string) { const d = await getDb(); if (d) await d.delete(STORE, hash); memory.delete(hash); },
    async clear() { const d = await getDb(); if (d) await d.clear(STORE); memory.clear(); },
    async estimateUsage(): Promise<number | null> {
      try { return (await navigator.storage.estimate()).usage ?? null; } catch { return null; }
    },
  };
}

export type Library = ReturnType<typeof createLibrary>;
export const library: Library = createLibrary();
