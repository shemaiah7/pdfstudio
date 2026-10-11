import { create } from "zustand";
import { countPages, addRotation } from "../pdf/pageOps";
import { sha256 } from "../pdf/hash";
import type { FieldDef } from "../pdf/formFill";
import type { Annotation, AnnotationPatch, Edit, FormValue, FormValues, NewAnnotation, PageEntry, SourceFile, SourceId } from "../pdf/types";

export const SIZE_WARNING_BYTES = 100 * 1024 * 1024;

// Hooks called with each source id that is dropped when openFiles replaces the document.
// Lets the renderer free pdf.js documents without the store importing pdf.js.
export const sourceReleasers: Array<(id: SourceId) => void> = [];

export interface OpenResult { skipped: string[]; oversized: string[] }

export interface Snapshot { pages: PageEntry[]; edits: Edit[]; annotations: Annotation[]; formValues: FormValues }

export interface DocumentState {
  sources: Map<SourceId, SourceFile>;
  pages: PageEntry[];
  selection: Set<string>;
  edits: Edit[];
  annotations: Annotation[];
  formValues: FormValues;
  selectedAnnotationId: string | null;
  past: Snapshot[];
  future: Snapshot[];
  savedPages: PageEntry[] | null;
  savedEdits: Edit[] | null;
  savedAnnotations: Annotation[] | null;
  savedFormValues: FormValues | null;
  error: string | null;
  openFiles(files: { name: string; bytes: Uint8Array }[], limit?: number): Promise<OpenResult>;
  addFiles(files: { name: string; bytes: Uint8Array }[], limit?: number): Promise<OpenResult>;
  reorder(ids: string[], toIndex: number): void;
  rotate(ids: string[], delta: 90 | -90): void;
  remove(ids: string[]): void;
  addEdit(e: Omit<Edit, "id">): string;
  removeEdit(id: string): void;
  addAnnotation(a: NewAnnotation): string;
  updateAnnotation(id: string, patch: AnnotationPatch): void;
  removeAnnotation(id: string): void;
  setFormValue(sourceId: SourceId, field: string, value: FormValue): void;
  clearForm(sourceId: SourceId, fields: FieldDef[]): void;
  selectAnnotation(id: string | null): void;
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

const keepSelection = (id: string | null, annotations: Annotation[]) =>
  id && annotations.some((a) => a.id === id) ? id : null;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function samePages(a: PageEntry[] | null, b: PageEntry[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((p, i) => p.id === b[i].id && p.rotation === b[i].rotation);
}

function sameEdits(a: Edit[] | null, b: Edit[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((e, i) => e.id === b[i].id && e.text === b[i].text);
}

function serializeFormValues(m: FormValues | null): string {
  if (!m) return "null";
  const rows = [...m.entries()]
    .map(([src, fields]) => [src, [...fields.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(rows);
}

function sameFormValues(a: FormValues | null, b: FormValues): boolean {
  if (a === b) return true;
  return a !== null && serializeFormValues(a) === serializeFormValues(b);
}

function sameAnnotations(a: Annotation[] | null, b: Annotation[]): boolean {
  if (a === b) return true;
  if (!a || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i] || (x.id === b[i].id && JSON.stringify(x) === JSON.stringify(b[i])));
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
      const hash = await sha256(f.bytes);
      sources.push({ id: nextId("src"), name: f.name, bytes: f.bytes, pageCount, hash });
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
  edits: [] as Edit[],
  annotations: [] as Annotation[],
  formValues: new Map() as FormValues,
  selectedAnnotationId: null as string | null,
  past: [] as Snapshot[],
  future: [] as Snapshot[],
  savedPages: null as PageEntry[] | null,
  savedEdits: null as Edit[] | null,
  savedAnnotations: null as Annotation[] | null,
  savedFormValues: null as FormValues | null,
  error: null as string | null,
});

export const useDocumentStore = create<DocumentState>((set, get) => {
  const snap = (s: DocumentState): Snapshot => ({ pages: s.pages, edits: s.edits, annotations: s.annotations, formValues: s.formValues });
  const commit = (patch: Partial<Snapshot>) =>
    set((s) => ({ ...patch, past: [...s.past, snap(s)], future: [] }));

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
      set({ ...initial(), sources: map, pages, savedPages: pages, savedEdits: [], savedAnnotations: [], savedFormValues: new Map() });
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
      commit({ pages: [...get().pages, ...sources.flatMap(entriesFor)] });
      return result;
    },

    reorder(ids, toIndex) {
      const moving = new Set(ids);
      const current = get().pages;
      const picked = current.filter((p) => moving.has(p.id));
      const rest = current.filter((p) => !moving.has(p.id));
      const before = current.slice(0, toIndex).filter((p) => !moving.has(p.id)).length;
      const next = [...rest.slice(0, before), ...picked, ...rest.slice(before)];
      commit({ pages: next });
    },

    rotate(ids, delta) {
      const set_ = new Set(ids);
      commit({ pages: get().pages.map((p) => (set_.has(p.id) ? { ...p, rotation: addRotation(p.rotation, delta) } : p)) });
    },

    remove(ids) {
      const gone = new Set(ids);
      const annotations = get().annotations.filter((a) => !gone.has(a.pageEntryId));
      commit({ pages: get().pages.filter((p) => !gone.has(p.id)), edits: get().edits.filter((e) => !gone.has(e.pageEntryId)), annotations });
      set((s) => ({
        selection: new Set([...s.selection].filter((id) => !gone.has(id))),
        selectedAnnotationId: s.selectedAnnotationId && annotations.some((a) => a.id === s.selectedAnnotationId) ? s.selectedAnnotationId : null,
      }));
    },

    addEdit(e) {
      const id = nextId("ed");
      commit({ edits: [...get().edits, { ...e, id }] });
      return id;
    },

    removeEdit(id) {
      commit({ edits: get().edits.filter((e) => e.id !== id) });
    },

    addAnnotation(a) {
      const id = nextId("an");
      commit({ annotations: [...get().annotations, { ...a, id } as Annotation] });
      return id;
    },

    updateAnnotation(id, patch) {
      if (!get().annotations.some((a) => a.id === id)) return;
      commit({ annotations: get().annotations.map((a) => (a.id === id ? ({ ...a, ...patch, id } as Annotation) : a)) });
    },

    removeAnnotation(id) {
      if (!get().annotations.some((a) => a.id === id)) return;
      commit({ annotations: get().annotations.filter((a) => a.id !== id) });
      if (get().selectedAnnotationId === id) set({ selectedAnnotationId: null });
    },

    setFormValue(sourceId, field, value) {
      const formValues = new Map([...get().formValues].map(([k, v]) => [k, new Map(v)]));
      const inner = formValues.get(sourceId) ?? new Map<string, FormValue>();
      inner.set(field, value);
      formValues.set(sourceId, inner);
      commit({ formValues });
    },

    clearForm(sourceId, fields) {
      const formValues = new Map([...get().formValues].map(([k, v]) => [k, new Map(v)]));
      // Explicit empty values (not deletion) so export also clears values already present in the source PDF.
      const empties = new Map<string, FormValue>();
      for (const f of fields) {
        if (f.type === "unsupported" || f.readOnly) continue;
        empties.set(f.name, f.type === "checkbox" ? false : f.multiple ? [] : "");
      }
      formValues.set(sourceId, empties);
      commit({ formValues });
    },

    selectAnnotation(id) { set({ selectedAnnotationId: id }); },

    undo() {
      set((s) => {
        if (s.past.length === 0) return {};
        const previous = s.past[s.past.length - 1];
        return { ...previous, selectedAnnotationId: keepSelection(s.selectedAnnotationId, previous.annotations), past: s.past.slice(0, -1), future: [snap(s), ...s.future] };
      });
    },

    redo() {
      set((s) => {
        if (s.future.length === 0) return {};
        const [next, ...rest] = s.future;
        return { ...next, selectedAnnotationId: keepSelection(s.selectedAnnotationId, next.annotations), past: [...s.past, snap(s)], future: rest };
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
    markClean() { set((s) => ({ savedPages: s.pages, savedEdits: s.edits, savedAnnotations: s.annotations, savedFormValues: s.formValues })); },
    setError(message) { set({ error: message }); },
    isDirty() {
      const s = get();
      return !samePages(s.savedPages, s.pages) || !sameEdits(s.savedEdits, s.edits)
        || !sameAnnotations(s.savedAnnotations, s.annotations) || !sameFormValues(s.savedFormValues, s.formValues);
    },
    canUndo() { return get().past.length > 0; },
    canRedo() { return get().future.length > 0; },
    reset() { set(initial()); },
  };
});
