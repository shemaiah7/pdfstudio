# Viewer Shell and Page Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-only React app that opens PDFs, shows pages and thumbnails, and lets the user merge, reorder, rotate, delete, extract, undo/redo, and download the result.

**Architecture:** A Zustand store holds opened files as raw bytes plus an ordered list of page entries; every page operation edits that list. pdf.js renders pages from the source bytes for display. pdf-lib builds the output document from the list on download. The page-operations module is pure and unit-tested in Node; the UI is thin.

**Tech Stack:** Vite 5, React 18, TypeScript, Zustand, pdfjs-dist, pdf-lib, @dnd-kit/core + @dnd-kit/sortable, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-viewer-and-page-tools-design.md`

## Global Constraints

- All processing happens in the browser; no network calls except loading the app's own assets.
- pdf.js takes ownership of Uint8Arrays passed to `getDocument`. Always pass `bytes.slice()`; never the store's original bytes.
- Page rotation values are only `0 | 90 | 180 | 270`.
- Download file names: `<first source name without .pdf>-edited.pdf` for full export, `<same>-pages.pdf` for extract.
- Files over 100 MB are allowed but show a warning banner.
- Layout must not break at 375 px width, but desktop is the target.
- Out of scope: annotations, text editing, forms, signatures, OCR, AI, password-protected PDFs, accounts, persistence.

## Review Focus

1. A PDF whose source pages already carry a `/Rotate` value: exported rotation must be source rotation plus the user's rotation, modulo 360, and the on-screen view must match. (Test added in Task 3.)
2. Dropping a non-PDF file alongside PDFs: PDFs open, the non-PDF is listed in the banner, nothing crashes. (Test added in Task 4.)
3. Deleting every page then undoing: the list is restored and the view shows pages again; Download is disabled while the list is empty. (Test added in Task 4 and Task 7.)
4. Opening the same file twice (merge a file with itself): two distinct source ids, ten entries for a five-page file, export has ten pages. (Test added in Task 3 and Task 4.)
5. Undo after download: the dirty flag must become true again because the current list no longer matches what was saved. (Test added in Task 4.)

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `.gitignore`, `vitest.config.ts`

**Interfaces:**
- Produces: a runnable Vite app and a passing `npm test` with zero tests.

- [ ] **Step 1: Scaffold with Vite**

```bash
cd /Volumes/MelaninServer/pdfstudio
npm create vite@latest . -- --template react-ts
```
If prompted that the directory is not empty, choose "Ignore files and continue".

- [ ] **Step 2: Install dependencies**

```bash
npm install zustand pdfjs-dist pdf-lib @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @playwright/test tsx
```

- [ ] **Step 3: Add vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [["src/components/**", "jsdom"]],
  },
});
```

- [ ] **Step 4: Add scripts to package.json**

In `package.json` `"scripts"`, ensure these exist:

```json
"dev": "vite",
"build": "tsc -b && vite build",
"preview": "vite preview",
"test": "vitest run",
"test:watch": "vitest",
"fixtures": "tsx scripts/make-fixtures.ts",
"e2e": "playwright test"
```

- [ ] **Step 5: Replace App.tsx and styles with a blank shell**

`src/App.tsx`:

```tsx
export default function App() {
  return <div className="app">PDF Studio</div>;
}
```

`src/styles.css`:

```css
:root {
  --bg: #f4f4f5;
  --panel: #ffffff;
  --border: #d4d4d8;
  --text: #18181b;
  --accent: #2563eb;
  --accent-soft: #dbeafe;
  --danger: #dc2626;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #18181b;
    --panel: #27272a;
    --border: #3f3f46;
    --text: #fafafa;
    --accent: #60a5fa;
    --accent-soft: #1e3a8a;
  }
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; }
.app { height: 100%; }
```

Delete `src/App.css` and `src/index.css` if Vite created them, and make `src/main.tsx` import `./styles.css` instead.

- [ ] **Step 6: Verify dev build and empty test run**

```bash
npm run build
npm test
```
Expected: build succeeds; vitest reports "No test files found" and exits 0 (if it exits 1, add `passWithNoTests: true` under `test` in `vitest.config.ts`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React TypeScript app with test tooling"
```

---

### Task 2: Test fixtures

**Files:**
- Create: `scripts/make-fixtures.ts`, `src/test/fixtures/three.pdf`, `src/test/fixtures/two.pdf`, `src/test/fixtures/rotated.pdf`, `src/test/loadFixture.ts`

**Interfaces:**
- Produces: `loadFixture(name: "three" | "two" | "rotated"): Uint8Array` for Node tests.
- Each fixture page draws a marker string `"<file>:<index>"` (for example `three:0`) as text. Page content is otherwise blank. `rotated.pdf` has two pages; page 1 (index 1) has `/Rotate 90` set at the source.

- [ ] **Step 1: Write the generator**

`scripts/make-fixtures.ts`:

```ts
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "src/test/fixtures");
mkdirSync(outDir, { recursive: true });

async function make(name: string, pageCount: number, rotateIndex?: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`${name}:${i}`, { x: 20, y: 360, size: 24, font });
    if (rotateIndex === i) page.setRotation(degrees(90));
  }
  writeFileSync(join(outDir, `${name}.pdf`), await doc.save());
}

await make("three", 3);
await make("two", 2);
await make("rotated", 2, 1);
console.log("fixtures written to", outDir);
```

- [ ] **Step 2: Write the loader**

`src/test/loadFixture.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FixtureName = "three" | "two" | "rotated";

export function loadFixture(name: FixtureName): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)),
  );
}
```

- [ ] **Step 3: Generate and verify**

```bash
npm run fixtures
ls -la src/test/fixtures
```
Expected: three `.pdf` files, each a few KB.

- [ ] **Step 4: Commit**

```bash
git add scripts/make-fixtures.ts src/test
git commit -m "test: add fixture generator and PDF fixtures"
```

---

### Task 3: Page operations (pdf-lib)

**Files:**
- Create: `src/pdf/types.ts`, `src/pdf/pageOps.ts`, `src/pdf/pageOps.test.ts`

**Interfaces:**
- Produces (`src/pdf/types.ts`):

```ts
export type SourceId = string;
export type Rotation = 0 | 90 | 180 | 270;
export interface SourceFile { id: SourceId; name: string; bytes: Uint8Array; pageCount: number; }
export interface PageEntry { id: string; sourceId: SourceId; sourcePageIndex: number; rotation: Rotation; }
```

- Produces (`src/pdf/pageOps.ts`):

```ts
export async function buildDocument(sources: Map<SourceId, SourceFile>, pages: PageEntry[]): Promise<Uint8Array>
export async function countPages(bytes: Uint8Array): Promise<number>
export function addRotation(a: Rotation, delta: 90 | -90 | 180): Rotation
```

- [ ] **Step 1: Write types**

`src/pdf/types.ts` exactly as in Interfaces above.

- [ ] **Step 2: Write the failing tests**

`src/pdf/pageOps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildDocument, countPages, addRotation } from "./pageOps";
import type { SourceFile, PageEntry } from "./types";
import { loadFixture } from "../test/loadFixture";

function src(id: string, name: "three" | "two" | "rotated", pageCount: number): SourceFile {
  return { id, name: `${name}.pdf`, bytes: loadFixture(name), pageCount };
}

function entry(sourceId: string, i: number, rotation: 0 | 90 | 180 | 270 = 0): PageEntry {
  return { id: `${sourceId}-${i}`, sourceId, sourcePageIndex: i, rotation };
}

async function markers(bytes: Uint8Array): Promise<string[]> {
  // Each fixture page's content stream contains its marker as a literal string.
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const text = contents ? new TextDecoder().decode(doc.context.lookup(contents as any)?.getContents?.() ?? new Uint8Array()) : "";
    const m = text.match(/\((\w+:\d+)\)/);
    out.push(m ? m[1] : "?");
  }
  return out;
}

describe("addRotation", () => {
  it("wraps within 0..270", () => {
    expect(addRotation(0, 90)).toBe(90);
    expect(addRotation(270, 90)).toBe(0);
    expect(addRotation(0, -90)).toBe(270);
    expect(addRotation(180, 180)).toBe(0);
  });
});

describe("countPages", () => {
  it("reads page count", async () => {
    expect(await countPages(loadFixture("three"))).toBe(3);
  });
});

describe("buildDocument", () => {
  const sources = new Map<string, SourceFile>([
    ["a", src("a", "three", 3)],
    ["b", src("b", "two", 2)],
  ]);

  it("merges two sources in list order", async () => {
    const pages = [entry("a", 0), entry("a", 1), entry("a", 2), entry("b", 0), entry("b", 1)];
    const out = await buildDocument(sources, pages);
    expect(await markers(out)).toEqual(["three:0", "three:1", "three:2", "two:0", "two:1"]);
  });

  it("reorders and deletes", async () => {
    const pages = [entry("b", 1), entry("a", 2), entry("a", 0)];
    const out = await buildDocument(sources, pages);
    expect(await markers(out)).toEqual(["two:1", "three:2", "three:0"]);
  });

  it("extracts a subset", async () => {
    const pages = [entry("a", 1)];
    const out = await buildDocument(sources, pages);
    expect(await countPages(out)).toBe(1);
    expect(await markers(out)).toEqual(["three:1"]);
  });

  it("applies rotation on top of source rotation", async () => {
    const s = new Map([["r", src("r", "rotated", 2)]]);
    const pages = [entry("r", 0, 90), entry("r", 1, 90)];
    const out = await buildDocument(s, pages);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(180); // 90 source + 90 user
  });

  it("can include the same source twice", async () => {
    const s = new Map([
      ["a1", src("a1", "three", 3)],
      ["a2", src("a2", "three", 3)],
    ]);
    const pages = [0, 1, 2].map((i) => entry("a1", i)).concat([0, 1, 2].map((i) => entry("a2", i)));
    const out = await buildDocument(s, pages);
    expect(await countPages(out)).toBe(6);
  });

  it("rejects an entry pointing past the source's page count", async () => {
    await expect(buildDocument(sources, [entry("a", 7)])).rejects.toThrow(/page 8/);
  });
});
```

Note on `markers`: pdf-lib exposes a page's content stream via `page.node.Contents()` which returns a ref or stream; `doc.context.lookup(ref)` returns a `PDFRawStream` with `getContents()`. If that call shape fails on the installed pdf-lib version, replace the helper body with this fallback that scans the whole file as text (fixture streams are uncompressed when generated by pdf-lib with `useObjectStreams: false`), and change the generator's `doc.save()` to `doc.save({ useObjectStreams: false })`:

```ts
async function markers(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const n = doc.getPageCount();
  const text = new TextDecoder("latin1").decode(bytes);
  const found = [...text.matchAll(/\((\w+:\d+)\) Tj/g)].map((m) => m[1]);
  // Streams appear in page order for documents written by pdf-lib.
  return found.slice(0, n);
}
```
Prefer the first version; use the fallback only if needed, and in that case also save with `useObjectStreams: false` inside `buildDocument`.

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/pdf/pageOps.test.ts
```
Expected: FAIL, cannot find module `./pageOps`.

- [ ] **Step 4: Implement**

`src/pdf/pageOps.ts`:

```ts
import { PDFDocument, degrees } from "pdf-lib";
import type { PageEntry, Rotation, SourceFile, SourceId } from "./types";

export function addRotation(a: Rotation, delta: 90 | -90 | 180): Rotation {
  return (((a + delta) % 360) + 360) % 360 as Rotation;
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return doc.getPageCount();
}

export async function buildDocument(
  sources: Map<SourceId, SourceFile>,
  pages: PageEntry[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const loaded = new Map<SourceId, PDFDocument>();

  for (const entry of pages) {
    const source = sources.get(entry.sourceId);
    if (!source) throw new Error(`Unknown source ${entry.sourceId}`);
    if (entry.sourcePageIndex >= source.pageCount) {
      throw new Error(
        `${source.name} has no page ${entry.sourcePageIndex + 1}`,
      );
    }
    let doc = loaded.get(entry.sourceId);
    if (!doc) {
      doc = await PDFDocument.load(source.bytes);
      loaded.set(entry.sourceId, doc);
    }
    const [copied] = await out.copyPages(doc, [entry.sourcePageIndex]);
    const base = copied.getRotation().angle;
    copied.setRotation(degrees((((base + entry.rotation) % 360) + 360) % 360));
    out.addPage(copied);
  }

  return out.save();
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npx vitest run src/pdf/pageOps.test.ts
```
Expected: all 8 tests PASS. If only `markers`-based tests fail, apply the fallback from Step 2.

- [ ] **Step 6: Commit**

```bash
git add src/pdf
git commit -m "feat: pure page operations with pdf-lib"
```

---

### Task 4: Document store

**Files:**
- Create: `src/store/document.ts`, `src/store/document.test.ts`

**Interfaces:**
- Consumes: `countPages`, `addRotation`, types from Task 3.
- Produces: `useDocumentStore` (Zustand hook) with this shape:

```ts
export interface OpenResult { skipped: string[]; oversized: string[] }
export interface DocumentState {
  sources: Map<SourceId, SourceFile>;
  pages: PageEntry[];
  selection: Set<string>;
  past: PageEntry[][];
  future: PageEntry[][];
  savedPages: PageEntry[] | null;   // list at last open/download; dirty = pages !== savedPages (deep compare)
  error: string | null;
  openFiles(files: { name: string; bytes: Uint8Array }[]): Promise<OpenResult>;  // replaces everything
  addFiles(files: { name: string; bytes: Uint8Array }[]): Promise<OpenResult>;   // appends
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
}
```

- [ ] **Step 1: Write the failing tests**

`src/store/document.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "./document";
import { loadFixture } from "../test/loadFixture";

const three = () => ({ name: "three.pdf", bytes: loadFixture("three") });
const two = () => ({ name: "two.pdf", bytes: loadFixture("two") });

const s = () => useDocumentStore.getState();
const order = () => s().pages.map((p) => `${s().sources.get(p.sourceId)!.name}:${p.sourcePageIndex}`);

beforeEach(() => useDocumentStore.getState().reset());

describe("open and add", () => {
  it("opens a file and builds entries", async () => {
    await s().openFiles([three()]);
    expect(order()).toEqual(["three.pdf:0", "three.pdf:1", "three.pdf:2"]);
    expect(s().isDirty()).toBe(false);
  });

  it("appends a second file", async () => {
    await s().openFiles([three()]);
    await s().addFiles([two()]);
    expect(order()).toEqual(["three.pdf:0", "three.pdf:1", "three.pdf:2", "two.pdf:0", "two.pdf:1"]);
    expect(s().isDirty()).toBe(true);
  });

  it("gives the same file two ids when added twice", async () => {
    await s().openFiles([three()]);
    await s().addFiles([three()]);
    expect(s().sources.size).toBe(2);
    expect(s().pages.length).toBe(6);
  });

  it("skips unreadable files and reports them", async () => {
    const res = await s().openFiles([three(), { name: "notes.txt", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(res.skipped).toEqual(["notes.txt"]);
    expect(s().pages.length).toBe(3);
  });

  it("flags oversized files", async () => {
    const big = { name: "big.pdf", bytes: loadFixture("two") };
    const res = await s().addFiles([big], 10); // 10-byte limit for the test
    expect(res.oversized).toEqual(["big.pdf"]);
    expect(s().pages.length).toBe(2); // still opened
  });
});

describe("page operations", () => {
  beforeEach(async () => { await s().openFiles([three()]); });

  it("reorders", () => {
    const ids = s().pages.map((p) => p.id);
    s().reorder([ids[0]], 3);
    expect(order()).toEqual(["three.pdf:1", "three.pdf:2", "three.pdf:0"]);
  });

  it("rotates and wraps", () => {
    const id = s().pages[0].id;
    s().rotate([id], -90);
    expect(s().pages[0].rotation).toBe(270);
    s().rotate([id], 90);
    expect(s().pages[0].rotation).toBe(0);
  });

  it("removes and clears selection of removed", () => {
    const [a, b] = s().pages.map((p) => p.id);
    s().select([a, b], "replace");
    s().remove([a]);
    expect(order()).toEqual(["three.pdf:1", "three.pdf:2"]);
    expect([...s().selection]).toEqual([b]);
  });

  it("deleting all then undo restores", () => {
    s().remove(s().pages.map((p) => p.id));
    expect(s().pages.length).toBe(0);
    s().undo();
    expect(s().pages.length).toBe(3);
  });

  it("undo and redo round-trip", () => {
    const before = s().pages;
    const id = s().pages[0].id;
    s().rotate([id], 90);
    s().undo();
    expect(s().pages).toEqual(before);
    expect(s().canRedo()).toBe(true);
    s().redo();
    expect(s().pages[0].rotation).toBe(90);
    expect(s().canRedo()).toBe(false);
  });

  it("new action after undo discards redo", () => {
    const id = s().pages[0].id;
    s().rotate([id], 90);
    s().undo();
    s().rotate([id], -90);
    expect(s().canRedo()).toBe(false);
  });

  it("dirty flag follows saved snapshot", () => {
    const id = s().pages[0].id;
    s().rotate([id], 90);
    expect(s().isDirty()).toBe(true);
    s().markClean();
    expect(s().isDirty()).toBe(false);
    s().undo();
    expect(s().isDirty()).toBe(true);
  });
});

describe("selection", () => {
  beforeEach(async () => { await s().openFiles([three()]); });

  it("replace, add, toggle", () => {
    const [a, b, c] = s().pages.map((p) => p.id);
    s().select([a], "replace");
    s().select([b], "add");
    expect([...s().selection].sort()).toEqual([a, b].sort());
    s().select([a], "toggle");
    expect([...s().selection]).toEqual([b]);
    s().select([c], "replace");
    expect([...s().selection]).toEqual([c]);
  });
});
```

Note: the tests call `reset()` and pass a byte limit to `addFiles`; include both in the implementation (`reset()` is test-only convenience; `limit` defaults to 100 MB).

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/store/document.test.ts
```
Expected: FAIL, cannot find module `./document`.

- [ ] **Step 3: Implement**

`src/store/document.ts`:

```ts
import { create } from "zustand";
import { countPages, addRotation } from "../pdf/pageOps";
import type { PageEntry, SourceFile, SourceId } from "../pdf/types";

export const SIZE_WARNING_BYTES = 100 * 1024 * 1024;

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
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/store/document.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store
git commit -m "feat: document store with page list, selection, undo/redo"
```

---

### Task 5: Renderer and basic viewer (open file, see pages)

**Files:**
- Create: `src/pdf/render.ts`, `src/components/DropZone.tsx`, `src/components/PageView.tsx`, `src/components/PageCanvas.tsx`, `src/components/ErrorBanner.tsx`
- Modify: `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `useDocumentStore`, `PageEntry`, `SourceFile`.
- Produces (`src/pdf/render.ts`):

```ts
export async function renderPage(source: SourceFile, pageIndex: number, rotation: Rotation, scale: number, canvas: HTMLCanvasElement): Promise<void>
export function releaseSource(sourceId: SourceId): void
```
- Produces `PageCanvas` component props: `{ source: SourceFile; entry: PageEntry; scale: number; className?: string }`.

Verification for this task is manual in the browser; the renderer depends on pdf.js's worker and canvas, which jsdom does not provide.

- [ ] **Step 1: Renderer**

`src/pdf/render.ts`:

```ts
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rotation, SourceFile, SourceId } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const docs = new Map<SourceId, Promise<PDFDocumentProxy>>();

function getDoc(source: SourceFile): Promise<PDFDocumentProxy> {
  let p = docs.get(source.id);
  if (!p) {
    // pdf.js takes ownership of the array it receives; pass a copy.
    p = pdfjs.getDocument({ data: source.bytes.slice() }).promise;
    docs.set(source.id, p);
  }
  return p;
}

export async function renderPage(
  source: SourceFile,
  pageIndex: number,
  rotation: Rotation,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const doc = await getDoc(source);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
}

export function releaseSource(sourceId: SourceId): void {
  const p = docs.get(sourceId);
  docs.delete(sourceId);
  p?.then((d) => d.destroy()).catch(() => {});
}
```

Note: `page.rotate` is the source's intrinsic rotation; adding the user's rotation keeps the view consistent with `buildDocument`.

- [ ] **Step 2: PageCanvas**

`src/components/PageCanvas.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { renderPage } from "../pdf/render";
import type { PageEntry, SourceFile } from "../pdf/types";

interface Props { source: SourceFile; entry: PageEntry; scale: number; className?: string; lazy?: boolean }

export default function PageCanvas({ source, entry, scale, className, lazy = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (!lazy || !ref.current) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [lazy]);

  useEffect(() => {
    if (!visible || !ref.current) return;
    let cancelled = false;
    renderPage(source, entry.sourcePageIndex, entry.rotation, scale, ref.current).catch((err) => {
      if (!cancelled) console.error("render failed", err);
    });
    return () => { cancelled = true; };
  }, [visible, source, entry.sourcePageIndex, entry.rotation, scale]);

  return <canvas ref={ref} className={className} data-page-id={entry.id} />;
}
```

- [ ] **Step 3: DropZone**

`src/components/DropZone.tsx`:

```tsx
import { useCallback, useRef, useState, type DragEvent } from "react";

interface Props { onFiles: (files: File[]) => void; empty: boolean }

export default function DropZone({ onFiles, empty }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = useCallback((e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  }, [onFiles]);

  return (
    <div
      className={`dropzone ${over ? "over" : ""} ${empty ? "empty" : "overlay"}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handle}
    >
      {empty && (
        <div className="dropzone-inner">
          <h1>PDF Studio</h1>
          <p>Drop PDF files here, or</p>
          <button onClick={() => input.current?.click()}>Choose files</button>
          <input ref={input} type="file" accept="application/pdf" multiple hidden
            onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <p className="muted">Files never leave your browser.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: ErrorBanner and PageView**

`src/components/ErrorBanner.tsx`:

```tsx
import { useDocumentStore } from "../store/document";

export default function ErrorBanner() {
  const error = useDocumentStore((s) => s.error);
  const setError = useDocumentStore((s) => s.setError);
  if (!error) return null;
  return (
    <div className="banner" role="alert">
      <span>{error}</span>
      <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
    </div>
  );
}
```

`src/components/PageView.tsx`:

```tsx
import { useDocumentStore } from "../store/document";
import PageCanvas from "./PageCanvas";

interface Props { scale: number }

export default function PageView({ scale }: Props) {
  const pages = useDocumentStore((s) => s.pages);
  const sources = useDocumentStore((s) => s.sources);
  const selection = useDocumentStore((s) => s.selection);
  const select = useDocumentStore((s) => s.select);

  return (
    <main className="pageview">
      {pages.map((entry, i) => {
        const source = sources.get(entry.sourceId)!;
        return (
          <div key={entry.id} id={`page-${entry.id}`}
            className={`page ${selection.has(entry.id) ? "selected" : ""}`}
            onClick={(e) => select([entry.id], e.metaKey || e.ctrlKey ? "toggle" : "replace")}>
            <PageCanvas source={source} entry={entry} scale={scale} lazy />
            <div className="page-label">{i + 1}</div>
          </div>
        );
      })}
    </main>
  );
}
```

- [ ] **Step 5: App wiring**

`src/App.tsx`:

```tsx
import { useCallback, useState } from "react";
import { useDocumentStore } from "./store/document";
import DropZone from "./components/DropZone";
import PageView from "./components/PageView";
import ErrorBanner from "./components/ErrorBanner";

async function toBytes(files: File[]) {
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export default function App() {
  const pages = useDocumentStore((s) => s.pages);
  const openFiles = useDocumentStore((s) => s.openFiles);
  const addFiles = useDocumentStore((s) => s.addFiles);
  const setError = useDocumentStore((s) => s.setError);
  const [scale] = useState(1.2);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const empty = useDocumentStore.getState().pages.length === 0;
    const res = await (empty ? openFiles : addFiles)(await toBytes(files));
    const msgs: string[] = [];
    if (res.skipped.length) msgs.push(`Couldn't read ${res.skipped.join(", ")} as a PDF.`);
    if (res.oversized.length) msgs.push(`${res.oversized.join(", ")} is very large; editing may be slow.`);
    if (msgs.length) setError(msgs.join(" "));
  }, [openFiles, addFiles, setError]);

  const empty = pages.length === 0;
  return (
    <div className="app">
      <ErrorBanner />
      {empty ? <DropZone onFiles={handleFiles} empty /> : (
        <>
          <DropZone onFiles={handleFiles} empty={false} />
          <PageView scale={scale} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Styles**

Append to `src/styles.css`:

```css
.app { display: grid; grid-template-rows: auto 1fr; position: relative; }
.banner { display: flex; justify-content: space-between; gap: 12px; padding: 8px 16px; background: #fef3c7; color: #78350f; border-bottom: 1px solid #f59e0b; }
.banner button { background: none; border: 0; font-size: 18px; cursor: pointer; color: inherit; }
.dropzone.empty { display: grid; place-items: center; height: 100%; border: 2px dashed var(--border); margin: 16px; border-radius: 12px; }
.dropzone.empty.over { border-color: var(--accent); background: var(--accent-soft); }
.dropzone.overlay { position: absolute; inset: 0; pointer-events: none; }
.dropzone.overlay.over { pointer-events: auto; background: color-mix(in srgb, var(--accent) 15%, transparent); border: 3px dashed var(--accent); }
.dropzone-inner { text-align: center; }
.dropzone-inner button { padding: 10px 18px; font-size: 16px; border-radius: 8px; border: 0; background: var(--accent); color: white; cursor: pointer; }
.muted { opacity: 0.6; font-size: 14px; }
.pageview { overflow: auto; padding: 24px 16px; display: flex; flex-direction: column; align-items: center; gap: 24px; }
.page { position: relative; box-shadow: 0 2px 10px rgba(0,0,0,0.2); background: white; outline: 3px solid transparent; cursor: pointer; }
.page.selected { outline-color: var(--accent); }
.page canvas { display: block; }
.page-label { position: absolute; bottom: 6px; right: 8px; font-size: 12px; background: rgba(0,0,0,0.6); color: white; padding: 2px 6px; border-radius: 4px; }
```

Note: because the drop overlay has `pointer-events: none` until a drag is in progress, the `dragover` on it will not fire. Add a window-level listener in `App.tsx` so dragging anywhere over the page sets the overlay active: in `App`, add

```tsx
useEffect(() => {
  const on = (e: globalThis.DragEvent) => { e.preventDefault(); setDragging(true); };
  const off = () => setDragging(false);
  window.addEventListener("dragover", on);
  window.addEventListener("dragleave", off);
  window.addEventListener("drop", off);
  return () => { window.removeEventListener("dragover", on); window.removeEventListener("dragleave", off); window.removeEventListener("drop", off); };
}, []);
```
with `const [dragging, setDragging] = useState(false)`, and pass `dragging` to the overlay `DropZone` as a new prop `forceOver?: boolean` that ORs into its `over` state (`className` uses `over || forceOver`). Import `useEffect` from React.

- [ ] **Step 7: Manual verification**

```bash
npm run dev
```
Open the app in the browser. Drop `src/test/fixtures/three.pdf`: three pages render with markers `three:0`, `three:1`, `three:2`. Drop `two.pdf` onto the open view: five pages. Drop a `.txt` file: banner appears, pages unchanged. Check the console has no "Setting up fake worker" warning.

- [ ] **Step 8: Build and commit**

```bash
npm run build
git add -A
git commit -m "feat: open PDFs and render pages with pdf.js"
```

---

### Task 6: Thumbnail sidebar with selection and drag reorder

**Files:**
- Create: `src/components/ThumbnailSidebar.tsx`, `src/components/Thumbnail.tsx`
- Modify: `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `useDocumentStore` (`pages`, `sources`, `selection`, `select`, `reorder`), `PageCanvas`.
- Produces: `<ThumbnailSidebar />` with no props. Each thumbnail has `data-testid="thumb"` and `data-page-id`.

- [ ] **Step 1: Thumbnail**

`src/components/Thumbnail.tsx`:

```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PageCanvas from "./PageCanvas";
import type { PageEntry, SourceFile } from "../pdf/types";

interface Props {
  entry: PageEntry; source: SourceFile; index: number; selected: boolean; multiSource: boolean;
  onClick: (e: React.MouseEvent) => void;
}

export default function Thumbnail({ entry, source, index, selected, multiSource, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`thumb ${selected ? "selected" : ""}`} data-testid="thumb" data-page-id={entry.id}
      title={multiSource ? source.name : undefined} onClick={onClick}>
      <PageCanvas source={source} entry={entry} scale={0.3} lazy />
      <div className="thumb-label">{index + 1}</div>
    </div>
  );
}
```

- [ ] **Step 2: Sidebar**

`src/components/ThumbnailSidebar.tsx`:

```tsx
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useDocumentStore } from "../store/document";
import Thumbnail from "./Thumbnail";

export default function ThumbnailSidebar() {
  const pages = useDocumentStore((s) => s.pages);
  const sources = useDocumentStore((s) => s.sources);
  const selection = useDocumentStore((s) => s.selection);
  const select = useDocumentStore((s) => s.select);
  const reorder = useDocumentStore((s) => s.reorder);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const ids = selection.has(activeId) ? pages.filter((p) => selection.has(p.id)).map((p) => p.id) : [activeId];
    const from = pages.findIndex((p) => p.id === activeId);
    const to = pages.findIndex((p) => p.id === over.id);
    reorder(ids, to > from ? to + 1 : to);
  };

  const onClick = (id: string, index: number) => (e: React.MouseEvent) => {
    if (e.shiftKey && selection.size > 0) {
      const anchor = pages.findIndex((p) => selection.has(p.id));
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      select(pages.slice(a, b + 1).map((p) => p.id), "replace");
    } else if (e.metaKey || e.ctrlKey) {
      select([id], "toggle");
    } else {
      select([id], "replace");
    }
    document.getElementById(`page-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <aside className="sidebar">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          {pages.map((entry, i) => (
            <Thumbnail key={entry.id} entry={entry} source={sources.get(entry.sourceId)!} index={i}
              selected={selection.has(entry.id)} multiSource={sources.size > 1} onClick={onClick(entry.id, i)} />
          ))}
        </SortableContext>
      </DndContext>
    </aside>
  );
}
```

- [ ] **Step 3: Layout in App**

In `src/App.tsx`, replace the non-empty branch with:

```tsx
<div className="workspace">
  <ThumbnailSidebar />
  <PageView scale={scale} />
  <aside className="rightpanel" />
  <DropZone onFiles={handleFiles} empty={false} forceOver={dragging} />
</div>
```
and import `ThumbnailSidebar`.

Append to `src/styles.css`:

```css
.workspace { display: grid; grid-template-columns: 180px 1fr 0; height: 100%; min-height: 0; position: relative; }
.sidebar { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: var(--panel); border-right: 1px solid var(--border); }
.thumb { position: relative; border: 2px solid transparent; border-radius: 6px; padding: 4px; cursor: grab; background: var(--bg); touch-action: none; }
.thumb.selected { border-color: var(--accent); background: var(--accent-soft); }
.thumb canvas { width: 100% !important; height: auto !important; display: block; }
.thumb-label { position: absolute; bottom: 8px; right: 8px; font-size: 11px; background: rgba(0,0,0,0.6); color: white; padding: 1px 5px; border-radius: 4px; }
@media (max-width: 700px) { .workspace { grid-template-columns: 96px 1fr 0; } }
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```
Open `three.pdf` then add `two.pdf`. Drag the first thumbnail to the end: the main view reorders to match. Cmd-click two thumbnails, drag one: both move together. Shift-click selects a range. Clicking a thumbnail scrolls the main view to that page. Hovering a thumbnail shows the source file name.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: thumbnail sidebar with selection and drag reorder"
```

---

### Task 7: Toolbar: undo, redo, rotate, delete, extract, download, zoom

**Files:**
- Create: `src/components/Toolbar.tsx`, `src/pdf/download.ts`, `src/pdf/download.test.ts`
- Modify: `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `buildDocument`, store actions.
- Produces (`src/pdf/download.ts`):

```ts
export function outputName(firstSourceName: string, kind: "edited" | "pages"): string
export function saveBlob(bytes: Uint8Array, filename: string): void
```
- Toolbar buttons carry `data-testid`: `open`, `add`, `undo`, `redo`, `rotate-left`, `rotate-right`, `delete`, `extract`, `download`, `zoom-in`, `zoom-out`.

- [ ] **Step 1: Failing test for output naming**

`src/pdf/download.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { outputName } from "./download";

describe("outputName", () => {
  it("strips .pdf case-insensitively and appends suffix", () => {
    expect(outputName("Report.PDF", "edited")).toBe("Report-edited.pdf");
    expect(outputName("scan", "pages")).toBe("scan-pages.pdf");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/pdf/download.test.ts
```
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement download helpers**

`src/pdf/download.ts`:

```ts
export function outputName(firstSourceName: string, kind: "edited" | "pages"): string {
  const base = firstSourceName.replace(/\.pdf$/i, "");
  return `${base}-${kind}.pdf`;
}

export function saveBlob(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/pdf/download.test.ts
```
Expected: PASS.

- [ ] **Step 5: Toolbar**

`src/components/Toolbar.tsx`:

```tsx
import { useRef, useState } from "react";
import { useDocumentStore } from "../store/document";
import { buildDocument } from "../pdf/pageOps";
import { outputName, saveBlob } from "../pdf/download";

interface Props { scale: number; setScale: (s: number) => void; onFiles: (files: File[], mode: "open" | "add") => void }

export default function Toolbar({ scale, setScale, onFiles }: Props) {
  const s = useDocumentStore();
  const [busy, setBusy] = useState(false);
  const openInput = useRef<HTMLInputElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const selected = [...s.selection];
  const hasSel = selected.length > 0;
  const firstName = s.pages[0] ? s.sources.get(s.pages[0].sourceId)!.name : "document.pdf";

  const exportPages = async (entries: typeof s.pages, kind: "edited" | "pages") => {
    setBusy(true);
    try {
      const bytes = await buildDocument(s.sources, entries);
      saveBlob(bytes, outputName(firstName, kind));
      if (kind === "edited") s.markClean();
    } catch (err) {
      s.setError(`Couldn't build the PDF: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = (ref: React.RefObject<HTMLInputElement>, mode: "open" | "add") => (
    <input ref={ref} type="file" accept="application/pdf" multiple hidden
      onChange={(e) => { onFiles(Array.from(e.target.files ?? []), mode); e.target.value = ""; }} />
  );

  return (
    <header className="toolbar">
      <button data-testid="open" onClick={() => openInput.current?.click()}>Open</button>
      {pick(openInput, "open")}
      <button data-testid="add" onClick={() => addInput.current?.click()}>Add file</button>
      {pick(addInput, "add")}
      <span className="sep" />
      <button data-testid="undo" disabled={!s.canUndo()} onClick={s.undo}>Undo</button>
      <button data-testid="redo" disabled={!s.canRedo()} onClick={s.redo}>Redo</button>
      <span className="sep" />
      <button data-testid="rotate-left" disabled={!hasSel} onClick={() => s.rotate(selected, -90)}>Rotate ⟲</button>
      <button data-testid="rotate-right" disabled={!hasSel} onClick={() => s.rotate(selected, 90)}>Rotate ⟳</button>
      <button data-testid="delete" disabled={!hasSel} onClick={() => s.remove(selected)}>Delete</button>
      <button data-testid="extract" disabled={!hasSel || busy}
        onClick={() => exportPages(s.pages.filter((p) => s.selection.has(p.id)), "pages")}>Extract selected</button>
      <span className="sep" />
      <button data-testid="zoom-out" onClick={() => setScale(Math.max(0.4, scale - 0.2))}>−</button>
      <span className="zoom">{Math.round(scale * 100)}%</span>
      <button data-testid="zoom-in" onClick={() => setScale(Math.min(3, scale + 0.2))}>+</button>
      <span className="grow" />
      <span className="count">{s.pages.length} page{s.pages.length === 1 ? "" : "s"}{s.isDirty() ? " • unsaved" : ""}</span>
      <button data-testid="download" className="primary" disabled={s.pages.length === 0 || busy}
        onClick={() => exportPages(s.pages, "edited")}>{busy ? "Building…" : "Download"}</button>
    </header>
  );
}
```

- [ ] **Step 6: Wire into App, add keyboard shortcuts and unload guard**

In `src/App.tsx`:
- change `handleFiles` signature to `(files: File[], mode: "open" | "add" = "auto")` where `"auto"` keeps the existing empty-check behaviour and `"open"`/`"add"` force it. Implement as: `const useOpen = mode === "open" || (mode === "auto" && empty)`.
- change `const [scale] = useState(1.2)` to `const [scale, setScale] = useState(1.2)`.
- render `<Toolbar scale={scale} setScale={setScale} onFiles={handleFiles} />` above the workspace when not empty.
- add:

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const st = useDocumentStore.getState();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); st.undo(); }
    else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); st.redo(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && st.selection.size) { e.preventDefault(); st.remove([...st.selection]); }
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    if (useDocumentStore.getState().isDirty()) { e.preventDefault(); e.returnValue = ""; }
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("beforeunload", onUnload);
  return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", onUnload); };
}, []);
```

Append to `src/styles.css`:

```css
.toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.toolbar button { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; }
.toolbar button:disabled { opacity: 0.4; cursor: default; }
.toolbar button.primary { background: var(--accent); color: white; border-color: transparent; }
.toolbar .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
.toolbar .grow { flex: 1; }
.toolbar .zoom, .toolbar .count { font-size: 13px; opacity: 0.8; padding: 0 4px; }
```

- [ ] **Step 7: Manual verification**

```bash
npm run dev
```
Open `three.pdf`. Select page 2, Rotate ⟳: thumbnail and main page both turn. Delete: page gone, count updates, "unsaved" appears. Cmd-Z restores it. Select two pages, Extract selected: a `three-pages.pdf` downloads with 2 pages (open it in the browser to confirm). Download: `three-edited.pdf`, "unsaved" disappears. Delete all pages: Download disabled, Undo restores. Reload with unsaved changes: browser prompts.

- [ ] **Step 8: Run all tests, build, commit**

```bash
npm test
npm run build
git add -A
git commit -m "feat: toolbar with undo/redo, rotate, delete, extract, download"
```

---

### Task 8: Playwright smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/reorder.spec.ts`
- Modify: `.gitignore` (add `test-results/`, `playwright-report/`)

**Interfaces:**
- Consumes: `data-testid="thumb"` thumbnails, `data-testid="download"` button, fixture `three.pdf`.

- [ ] **Step 1: Config**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  webServer: { command: "npm run dev -- --port 5199", port: 5199, reuseExistingServer: true },
  use: { baseURL: "http://localhost:5199", headless: true },
});
```

Install the browser once:

```bash
npx playwright install chromium
```

- [ ] **Step 2: Test**

`e2e/reorder.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";

test("drag first page to end and download in new order", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', "src/test/fixtures/three.pdf");
  const thumbs = page.getByTestId("thumb");
  await expect(thumbs).toHaveCount(3);

  const first = thumbs.nth(0);
  const last = thumbs.nth(2);
  const a = await first.boundingBox();
  const b = await last.boundingBox();
  if (!a || !b) throw new Error("no thumbs");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 4, { steps: 10 });
  await page.mouse.up();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download").click(),
  ]);
  expect(download.suggestedFilename()).toBe("three-edited.pdf");
  const path = await download.path();
  const doc = await PDFDocument.load(readFileSync(path!));
  expect(doc.getPageCount()).toBe(3);
  const text = new TextDecoder("latin1").decode(readFileSync(path!));
  // Marker order in output stream order should be 1, 2, 0.
  const found = [...text.matchAll(/\((three:\d)\)/g)].map((m) => m[1]);
  expect(found.slice(0, 3)).toEqual(["three:1", "three:2", "three:0"]);
});
```

If the marker scan returns nothing because pdf-lib compressed the streams, change `buildDocument` in `src/pdf/pageOps.ts` to `return out.save({ useObjectStreams: false })` (page content streams copied from the uncompressed fixtures remain uncompressed; object streams only affect the object table) and, if still nothing, set the generator in Task 2 to `doc.save({ useObjectStreams: false })` and regenerate fixtures.

- [ ] **Step 3: Run**

```bash
npm run e2e
```
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: Playwright smoke test for reorder and download"
```

---

## Self-review notes

- Spec coverage: open/add (T5), render + lazy thumbnails (T5, T6), merge (T4/T5), split/extract (T7), reorder (T6), rotate/delete (T7), undo/redo (T4/T7), download naming (T7), unreadable and oversized files (T4/T5), export failure banner (T7), beforeunload (T7), unit tests (T3/T4/T7), Playwright (T8), right panel placeholder (T6). Password-protected message from the spec is covered by the generic "couldn't read" message since pdf-lib throws on encrypted files without `ignoreEncryption`; a dedicated password message is deferred with password support.
- Review Focus items 1–5 map to tests in T3 (rotation, same source twice), T4 (non-PDF skipped, delete-all undo, same source twice, dirty after undo), T7 (download disabled when empty, manual).
- Type consistency: `PageEntry`, `SourceFile`, `Rotation`, `buildDocument`, `countPages`, `addRotation`, `outputName`, `saveBlob`, store action names are used identically across tasks.
