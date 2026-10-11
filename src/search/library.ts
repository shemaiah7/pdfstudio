import { openDB, type IDBPDatabase } from "idb";
import type { Chunk } from "./chunker";
import type { RankDoc } from "./ranker";
import { DIMS, MODEL_TAG } from "./constants";

export interface LibraryRecord {
  hash: string; name: string; size: number; pageCount: number; addedAt: number; modelId: string;
  bytes: Blob; chunks: Chunk[]; vectors: Float32Array;
  editsStamp: number; // timestamp of the in-session edits the index was built from; 0 when none
  ocrVersion: number; // newest OCR page timestamp the index was built from; 0 when none
}
export interface LibrarySummary { hash: string; name: string; size: number; pageCount: number; addedAt: number; modelId: string; chunkCount: number; stale: boolean }

const STORE = "documents";
const SUMMARIES = "summaries";

type StoredSummary = Omit<LibrarySummary, "stale"> & { vectorLength: number; ocrVersion: number; editsStamp: number };

export function openLibraryDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, 2, {
    upgrade(d) {
      for (const name of [STORE, SUMMARIES]) {
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: "hash" });
      }
    },
  });
}

export { sha256 } from "../pdf/hash";

type Opener = () => Promise<IDBPDatabase>;

export function createLibrary(dbName = "pdfstudio-search", open?: Opener) {
  // In-memory records: everything when the DB cannot be opened, otherwise an overlay of records whose write failed.
  const memory = new Map<string, LibraryRecord>();
  let db: Promise<IDBPDatabase> | null = null;
  const state = { persistent: true, lastWriteFailed: false };
  let activeTag = MODEL_TAG; // records indexed under another tag (dtype) count as stale
  const opener: Opener = open ?? (() => openLibraryDb(dbName));
  const getDb = async (): Promise<IDBPDatabase | null> => {
    if (!state.persistent) return null;
    try { return await (db ??= Promise.resolve().then(opener)); }
    catch { state.persistent = false; db = null; return null; }
  };
  const valid = (r: { modelId: string; chunkCount: number; vectorLength: number }) =>
    r.modelId === activeTag && r.vectorLength === r.chunkCount * DIMS;
  const stored = (r: LibraryRecord): StoredSummary => ({ hash: r.hash, name: r.name, size: r.size, pageCount: r.pageCount, addedAt: r.addedAt, modelId: r.modelId, chunkCount: r.chunks.length, vectorLength: r.vectors.length, ocrVersion: r.ocrVersion ?? 0, editsStamp: r.editsStamp ?? 0 });
  const summary = (s: StoredSummary): LibrarySummary => {
    const { vectorLength: _v, ocrVersion: _o, editsStamp: _e, ...rest } = s;
    return { ...rest, stale: !valid(s) };
  };
  const revive = (r: LibraryRecord): LibraryRecord => ({ ...r, ocrVersion: r.ocrVersion ?? 0, editsStamp: r.editsStamp ?? 0, vectors: r.vectors instanceof Float32Array ? r.vectors : new Float32Array(r.vectors as unknown as ArrayLike<number>) });
  const usable = (r: LibraryRecord | undefined): LibraryRecord | undefined => {
    if (!r) return undefined;
    const v = revive(r);
    return valid({ modelId: v.modelId, chunkCount: v.chunks.length, vectorLength: v.vectors.length }) ? v : undefined;
  };

  return {
    get modelTag() { return activeTag; },
    setModelTag(tag: string) { activeTag = tag; },
    get persistent() { return state.persistent; },
    get lastWriteFailed() { return state.lastWriteFailed; },
    async put(record: LibraryRecord) {
      const d = await getDb();
      if (d) {
        try {
          const tx = d.transaction([STORE, SUMMARIES], "readwrite");
          await Promise.all([tx.objectStore(STORE).put(record), tx.objectStore(SUMMARIES).put(stored(record)), tx.done]);
          memory.delete(record.hash);
          state.lastWriteFailed = false;
          return;
        } catch { state.lastWriteFailed = true; }
      }
      memory.set(record.hash, record);
    },
    /** Keeps the record for this session only (nothing is written), e.g. an index built from unsaved edits. */
    putMemory(record: LibraryRecord): void { memory.set(record.hash, record); },
    async get(hash: string): Promise<LibraryRecord | undefined> {
      const mem = memory.get(hash);
      if (mem) return usable(mem);
      const d = await getDb();
      return d ? usable((await d.get(STORE, hash)) as LibraryRecord | undefined) : undefined;
    },
    async list(): Promise<LibrarySummary[]> {
      const d = await getDb();
      const all = new Map<string, StoredSummary>();
      if (d) for (const s of (await d.getAll(SUMMARIES)) as StoredSummary[]) all.set(s.hash, s);
      for (const r of memory.values()) all.set(r.hash, stored(r));
      return [...all.values()].map(summary).sort((a, b) => b.addedAt - a.addedAt);
    },
    async loadAll(): Promise<RankDoc[]> {
      const d = await getDb();
      const all = new Map<string, LibraryRecord>();
      if (d) for (const r of (await d.getAll(STORE)) as LibraryRecord[]) all.set(r.hash, r);
      for (const r of memory.values()) all.set(r.hash, r);
      return [...all.values()].map(usable).filter((r): r is LibraryRecord => !!r).map((r) => ({ hash: r.hash, chunks: r.chunks, vectors: r.vectors }));
    },
    async remove(hash: string) {
      memory.delete(hash);
      const d = await getDb();
      if (!d) return;
      try {
        const tx = d.transaction([STORE, SUMMARIES], "readwrite");
        await Promise.all([tx.objectStore(STORE).delete(hash), tx.objectStore(SUMMARIES).delete(hash), tx.done]);
      } catch { state.lastWriteFailed = true; }
    },
    async clear() {
      memory.clear();
      const d = await getDb();
      if (!d) return;
      try {
        const tx = d.transaction([STORE, SUMMARIES], "readwrite");
        await Promise.all([tx.objectStore(STORE).clear(), tx.objectStore(SUMMARIES).clear(), tx.done]);
        state.lastWriteFailed = false;
      } catch { state.lastWriteFailed = true; }
    },
    async estimateUsage(): Promise<number | null> {
      try { return (await navigator.storage.estimate()).usage ?? null; } catch { return null; }
    },
  };
}

export type Library = ReturnType<typeof createLibrary>;
export const library: Library = createLibrary();
