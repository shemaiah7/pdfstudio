# PDF Studio: Viewer Shell and Page Tools (Sub-project 1)

Date: 2026-10-10
Status: Draft for review

## Product context

PDF Studio is a browser-based alternative to Adobe Acrobat aimed at the public.
Its intended edge over Acrobat is smarter, AI-assisted editing. The full product
is built as a sequence of sub-projects, each with its own spec and plan:

1. **Viewer shell and page tools** (this spec)
2. AI assist (summarize, ask, rewrite, suggest form values) via a Cloudflare
   Worker proxy so the API key never ships to the browser
3. Annotations, form filling, signatures (pdf.js annotation editor + pdf-lib)
4. Overlay text editing (cover the original text, draw replacement text in a
   matched font). True content-stream text editing is explicitly deferred; no
   JavaScript library supports it and pdf-lib documents this limitation.
5. OCR for scanned pages (Tesseract.js, lazy-loaded) producing a text layer
   that feeds search, AI, and overlay editing

Stack decision (approved): Vite + React + TypeScript, pdf.js for rendering,
pdf-lib for document modification, Tesseract.js later for OCR, Cloudflare
Worker later for the AI proxy. All file processing happens in the browser.

## Goal of this sub-project

A working single-page app that opens one or more PDFs, shows them, lets the
user merge, split, reorder, rotate, and delete pages with undo/redo, and
downloads the result. This proves the open → modify → save round trip that
every later sub-project depends on.

## Users and success criteria

- A visitor with no account drops a PDF onto the page and sees it rendered
  within a couple of seconds for typical documents.
- They can add a second PDF, drag pages into any order, rotate some, delete
  some, undo a mistake, and download a single merged PDF whose page order and
  rotation match what they saw.
- They can select a page range and download only those pages (split).
- Nothing is uploaded; the app works offline after first load.

## Architecture

### Document store (`src/store/document.ts`, Zustand)

Single store holding:

- `sources: Map<SourceId, { name: string; bytes: Uint8Array; pageCount: number }>`
  Each opened file, kept as original bytes.
- `pages: PageEntry[]` where `PageEntry = { id: string; sourceId: SourceId;
  sourcePageIndex: number; rotation: 0 | 90 | 180 | 270 }`
  The working document is this ordered list. All page operations mutate the
  list, never the PDF bytes, so they are instant.
- `selection: Set<string>` of page entry ids.
- `history: { past: PageEntry[][]; future: PageEntry[][] }` for undo/redo.
  Snapshots are shallow copies of the list; the list is small.
- `dirty: boolean`, true when `pages` differs from the state at last open or
  download.

Actions: `openFiles(files)`, `addFiles(files)`, `reorder(fromIds, toIndex)`,
`rotate(ids, delta)`, `remove(ids)`, `undo()`, `redo()`, `select(ids, mode)`,
`markClean()`.

### Renderer (`src/pdf/render.ts`, pdf.js)

- Loads each source's bytes once into a `PDFDocumentProxy` (cached per
  source id). Rendering runs in pdf.js's web worker.
- `renderPage(sourceId, pageIndex, scale, rotation, canvas)` renders one page.
- Main view renders the page at the current zoom; thumbnails render at a fixed
  small scale. Thumbnails render lazily when scrolled into view
  (IntersectionObserver) and are cached by `(sourceId, pageIndex, rotation)`.
- Rotation in the view is applied via pdf.js's viewport rotation parameter so
  the on-screen result matches the exported result.

### Page operations (`src/pdf/pageOps.ts`, pdf-lib)

Pure functions, no DOM, no store access:

- `buildDocument(sources, pages): Promise<Uint8Array>`
  Creates a new `PDFDocument`, loads each distinct source once, copies pages
  in list order with `copyPages`, sets each copied page's rotation to the
  source page's existing rotation plus the entry's rotation, saves, returns
  bytes.
- `buildDocument` is used for both full download and split (the caller passes
  the subset of entries).

Merge is purely a store operation (append entries for the new source); the
export path is the same.

### UI shell (`src/components/`)

- `App` – layout grid: toolbar top, thumbnail sidebar left, page view center,
  right panel placeholder (empty, reserved for later sub-projects).
- `Toolbar` – Open, Add file, Undo, Redo, Rotate left/right (selected),
  Delete (selected), Extract selected (split), Download. Zoom controls and
  page indicator.
- `DropZone` – full-window drag-and-drop target plus file input; shown as the
  empty state before any file is opened and as an overlay while dragging.
- `ThumbnailSidebar` – one `Thumbnail` per page entry. Click selects, shift
  and cmd/ctrl click extend selection, drag-and-drop reorders (dnd-kit).
  Shows source file name on hover when more than one source is open.
- `PageView` – vertically scrolling list of rendered pages at the current
  zoom. Clicking a page selects it and scrolls the sidebar to it.
- `ErrorBanner` – inline message for load and export errors.

### Data flow

1. User opens files → store `openFiles` reads bytes, loads page counts via
   pdf.js, builds `pages`, pushes history snapshot.
2. Components subscribe to `pages`; thumbnails and view render from the list.
3. Page operations mutate the list and push history.
4. Download → `buildDocument(sources, pages)` → Blob → anchor download,
   named `<first source name>-edited.pdf`. Extract selected → same with the
   selected entries, named `<name>-pages.pdf`.
5. `markClean()` after a successful download.

### Module boundaries

```
src/
  store/document.ts      state + actions, unit-testable without DOM
  pdf/render.ts          pdf.js wrapper
  pdf/pageOps.ts         pdf-lib pure functions
  components/            React UI
  test/fixtures/         small generated PDFs
```

## Error handling

- **Unreadable file**: pdf.js or pdf-lib throws on load. The store catches it,
  leaves existing state untouched, and `ErrorBanner` shows "`<name>` couldn't
  be read as a PDF." Password-protected files show "`<name>` is
  password-protected; that's not supported yet." (pdf.js reports
  `PasswordException`.)
- **Large files**: rendering is already off the main thread. Files over 100 MB
  show a warning banner but are allowed. Thumbnails are lazy.
- **Export failure**: if `buildDocument` throws, the banner names the failing
  page number when pdf-lib provides one, and the working state is unchanged.
- **Unsaved changes**: `beforeunload` handler warns while `dirty` is true.
- **Non-PDF files** dropped: ignored with a banner listing the skipped names.

## Testing

- **Unit (Vitest, node environment)** for `pageOps.ts`:
  - merge two fixture PDFs (3 pages + 2 pages) → 5 pages in expected order,
    verified by reloading output with pdf-lib and reading page count and a
    per-page marker (each fixture page draws its own index as text).
  - split a range → correct count and markers.
  - rotate one entry by 90 → output page `getRotation()` equals source
    rotation + 90.
  - delete and reorder → order of markers matches.
- **Unit for the store**: each action produces the expected `pages`; undo
  then redo restores the exact list; `dirty` flag transitions.
- **Browser smoke (Playwright, one test)**: open fixture, drag the first
  thumbnail to the end, click Download, read the saved file with pdf-lib, and
  assert the new order.
- **Manual**: verify in the app's built-in browser after implementation.

Fixtures are generated by a script (`scripts/make-fixtures.ts`) using pdf-lib
and committed, so tests do not depend on external files.

## Out of scope for this sub-project

Annotations, text editing, form filling, signatures, OCR, AI features,
password-protected PDFs, accounts, persistence between sessions, mobile layout
polish (must not break at phone width, but desktop is the target).

## Open decisions already made

- Overlay text editing (not true content-stream editing) for sub-project 4.
- AI assist requires a server-side proxy; document text sent to the AI leaves
  the browser, PDF bytes do not. This will be stated in the product's privacy
  copy when sub-project 2 ships.
