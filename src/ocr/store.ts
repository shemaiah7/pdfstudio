import { openDB, type IDBPDatabase } from "idb";
import type { OcrPage } from "./types";

export interface OcrRecord extends OcrPage { hash: string; pageIndex: number }
const STORE = "pages";
const key = (hash: string, pageIndex: number) => `${hash}:${pageIndex}`;

export function openOcrDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, 1, { upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); } });
}

type Opener = () => Promise<IDBPDatabase>;

export function createOcrStore(dbName = "pdfstudio-ocr", open?: Opener) {
  const memory = new Map<string, OcrRecord>();
  let db: Promise<IDBPDatabase> | null = null;
  const state = { persistent: true, lastWriteFailed: false };
  const opener: Opener = open ?? (() => openOcrDb(dbName));
  const getDb = async (): Promise<IDBPDatabase | null> => {
    if (!state.persistent) return null;
    try { return await (db ??= Promise.resolve().then(opener)); }
    catch { state.persistent = false; db = null; return null; }
  };
  const strip = (r: OcrRecord): OcrPage => ({ engine: r.engine, lines: r.lines, confidence: r.confidence, at: r.at });
  return {
    get persistent() { return state.persistent; },
    get lastWriteFailed() { return state.lastWriteFailed; },
    async put(hash: string, pageIndex: number, page: OcrPage) {
      const record: OcrRecord = { ...page, hash, pageIndex };
      const d = await getDb();
      if (d) {
        try {
          const tx = d.transaction(STORE, "readwrite");
          await Promise.all([tx.objectStore(STORE).put(record, key(hash, pageIndex)), tx.done]);
          memory.delete(key(hash, pageIndex));
          state.lastWriteFailed = false;
          return;
        } catch { state.lastWriteFailed = true; }
      }
      memory.set(key(hash, pageIndex), record);
    },
    async get(hash: string, pageIndex: number): Promise<OcrPage | undefined> {
      const mem = memory.get(key(hash, pageIndex));
      if (mem) return strip(mem);
      const d = await getDb();
      const r = d ? ((await d.get(STORE, key(hash, pageIndex))) as OcrRecord | undefined) : undefined;
      return r ? strip(r) : undefined;
    },
    async getAll(hash: string): Promise<Map<number, OcrPage>> {
      const out = new Map<number, OcrPage>();
      const d = await getDb();
      if (d) {
        const range = IDBKeyRange.bound(`${hash}:`, `${hash}:￿`);
        for (const r of (await d.getAll(STORE, range)) as OcrRecord[]) out.set(r.pageIndex, strip(r));
      }
      for (const r of memory.values()) if (r.hash === hash) out.set(r.pageIndex, strip(r));
      return new Map([...out.entries()].sort((a, b) => a[0] - b[0]));
    },
    async remove(hash: string) {
      for (const k of [...memory.keys()]) if (k.startsWith(`${hash}:`)) memory.delete(k);
      const d = await getDb();
      if (!d) return;
      try {
        const tx = d.transaction(STORE, "readwrite");
        const range = IDBKeyRange.bound(`${hash}:`, `${hash}:￿`);
        await Promise.all([tx.objectStore(STORE).delete(range), tx.done]);
      } catch { state.lastWriteFailed = true; }
    },
    async clear() {
      memory.clear();
      const d = await getDb();
      if (!d) return;
      try { await d.clear(STORE); state.lastWriteFailed = false; } catch { state.lastWriteFailed = true; }
    },
  };
}

export type OcrStore = ReturnType<typeof createOcrStore>;
export const ocrStore: OcrStore = createOcrStore();
