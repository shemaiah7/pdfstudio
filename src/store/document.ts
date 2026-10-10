import { create } from "zustand";
import { countPages, addRotation } from "../pdf/pageOps";
import type { PageEntry, SourceFile, SourceId } from "../pdf/types";

export const SIZE_WARNING_BYTES = 100 * 1024 * 1024;

// Hooks called with each source id that is dropped when openFiles replaces the document.
// Lets the renderer free pdf.js documents without the store importing pdf.js.
export const sourceReleasers: Array<(id: SourceId) => void> = [];

export interface OpenResult { skipped: string[]; oversized: string[] }

export interface DocumentState {
  sources: Map<SourceId, SourceFile>;
  pages: PageEntry[];
  selection: Set<string>;
  past: PageEntry[][];
  future: PageEntry[][];
  savedPages: PageEntry[] | null;
  error: string | null;
  openFiles(files: { name: string; bytes: Uint8Array }[], limit?: number): Promise<OpenResult>;
  addFiles(files: { name: string; bytes: Uint8Array }[], limit?: number): Promise<OpenResult>;
  reorder(ids: string[], toIndex: number): void;
  rotate(ids: string[], delta: 90 | -90): void;
  remove(ids: string[]): void;
  undo(): void;
  redo(): void;
  select(ids: string[], mode: "replace" | "toggle" | "add"): void;
  clearSelection(): void;
  markClean(): void;
  setError(message: string | null): void;
  isDirty(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  reset(): void;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function samePages(a: PageEntry[] | null, b: PageEntry[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((p, i) => p.id === b[i].id && p.rotation === b[i].rotation);
}

async function loadSources(
  files: { name: string; bytes: Uint8Array }[],
  limit: number,
): Promise<{ sources: SourceFile[]; result: OpenResult }> {
  const sources: SourceFile[] = [];
  const result: OpenResult = { skipped: [], oversized: [] };
  for (const f of files) {
    try {
      const pageCount = await countPages(f.bytes);
      sources.push({ id: nextId("src"), name: f.name, bytes: f.bytes, pageCount });
      if (f.bytes.byteLength > limit) result.oversized.push(f.name);
    } catch {
      result.skipped.push(f.name);
    }
  }
  return { sources, result };
}

function entriesFor(source: SourceFile): PageEntry[] {
  return Array.from({ length: source.pageCount }, (_, i) => ({
    id: nextId("pg"),
    sourceId: source.id,
    sourcePageIndex: i,
    rotation: 0,
  }));
}

const initial = () => ({
  sources: new Map<SourceId, SourceFile>(),
  pages: [] as PageEntry[],
  selection: new Set<string>(),
  past: [] as PageEntry[][],
  future: [] as PageEntry[][],
  savedPages: null as PageEntry[] | null,
  error: null as string | null,
});

export const useDocumentStore = create<DocumentState>((set, get) => {
  const commit = (pages: PageEntry[]) =>
    set((s) => ({ pages, past: [...s.past, s.pages], future: [] }));

  return {
    ...initial(),

    async openFiles(files, limit = SIZE_WARNING_BYTES) {
      const { sources, result } = await loadSources(files, limit);
      if (sources.length === 0) {
        set({ error: files.length ? `Couldn't read ${result.skipped.join(", ")} as a PDF.` : null });
        return result;
      }
      for (const id of get().sources.keys()) sourceReleasers.forEach((release) => release(id));
      const map = new Map(sources.map((s) => [s.id, s]));
      const pages = sources.flatMap(entriesFor);
      set({ ...initial(), sources: map, pages, savedPages: pages });
      return result;
    },

    async addFiles(files, limit = SIZE_WARNING_BYTES) {
      const { sources, result } = await loadSources(files, limit);
      if (sources.length === 0) return result;
      set((s) => {
        const map = new Map(s.sources);
        for (const src of sources) map.set(src.id, src);
        return { sources: map };
      });
      commit([...get().pages, ...sources.flatMap(entriesFor)]);
      return result;
    },

    reorder(ids, toIndex) {
      const moving = new Set(ids);
      const current = get().pages;
      const picked = current.filter((p) => moving.has(p.id));
      const rest = current.filter((p) => !moving.has(p.id));
      const before = current.slice(0, toIndex).filter((p) => !moving.has(p.id)).length;
      const next = [...rest.slice(0, before), ...picked, ...rest.slice(before)];
      commit(next);
    },

    rotate(ids, delta) {
      const set_ = new Set(ids);
      commit(get().pages.map((p) => (set_.has(p.id) ? { ...p, rotation: addRotation(p.rotation, delta) } : p)));
    },

    remove(ids) {
      const gone = new Set(ids);
      commit(get().pages.filter((p) => !gone.has(p.id)));
      set((s) => ({ selection: new Set([...s.selection].filter((id) => !gone.has(id))) }));
    },

    undo() {
      set((s) => {
        if (s.past.length === 0) return {};
        const previous = s.past[s.past.length - 1];
        return { pages: previous, past: s.past.slice(0, -1), future: [s.pages, ...s.future] };
      });
    },

    redo() {
      set((s) => {
        if (s.future.length === 0) return {};
        const [next, ...rest] = s.future;
        return { pages: next, past: [...s.past, s.pages], future: rest };
      });
    },

    select(ids, mode) {
      set((s) => {
        if (mode === "replace") return { selection: new Set(ids) };
        const sel = new Set(s.selection);
        for (const id of ids) {
          if (mode === "add") sel.add(id);
          else sel.has(id) ? sel.delete(id) : sel.add(id);
        }
        return { selection: sel };
      });
    },

    clearSelection() { set({ selection: new Set() }); },
    markClean() { set((s) => ({ savedPages: s.pages })); },
    setError(message) { set({ error: message }); },
    isDirty() { return !samePages(get().savedPages, get().pages); },
    canUndo() { return get().past.length > 0; },
    canRedo() { return get().future.length > 0; },
    reset() { set(initial()); },
  };
});
