# SentinelPDF Rename and Desktop Installers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app to SentinelPDF, ship signed Mac and unsigned Windows Electron installers that open PDFs like Acrobat, and move the site to sentinelpdf.com.

**Architecture:** The web app keeps running on Cloudflare. A new `desktop/` Electron shell loads the live site in one locked-down window, registers for `.pdf`, and passes opened files to the page through a one-method preload bridge that feeds the existing `handleFiles`. GitHub Actions builds and publishes installers to GitHub Releases on `desktop-v*` tags; `electron-updater` updates the shell.

**Tech Stack:** Vite + React 19 + TS (web), Cloudflare Workers (wrangler), Electron + electron-builder + electron-updater, vitest, Playwright (`_electron`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-15-sentinelpdf-desktop-design.md`

## Global Constraints

- Display name is exactly `SentinelPDF` (one word, capital S, P, D, F).
- Mac app ID `com.sentinelpdf.desktop`; productName `SentinelPDF`.
- Do NOT rename: repo, Workers `pdfstudio` / `pdfstudio-ai`, D1 `pdfstudio`, KV, any `localStorage` key `pdfstudio.*`, service-worker cache names, npm package names, manifest `id` (`/`), `AGENT_NAME` in `worker/src/prompts/live.ts` (provisioning finds the ElevenLabs agent by this name — changing it orphans the live agent).
- Desktop window loads only `APP_URL`'s origin; every other http(s) URL opens in the default browser; microphone (`media`) granted only to the app origin; `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Opened files: name must end in `.pdf` (case-insensitive), size ≤ 200 MB (209715200 bytes).
- Installer asset names: `SentinelPDF-mac.dmg`, `SentinelPDF-mac.zip`, `SentinelPDF-windows.exe`.
- Mac signing secrets (GitHub): `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Never read, print or create these values.
- Work only in `/Volumes/MelaninServer/pdfstudio-wt-desktop` (branch `feat/desktop`). Never touch `/Volumes/MelaninServer/pdfstudio`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Root checks after any web change: `npm run lint`, `npm run build`, `npm test` all pass. Worker changes: `npm --prefix worker test` passes.

## Review Focus

1. A PDF double-clicked while the app is closed (Mac `open-file` fires before the window exists) must open once the page is ready — pinned in Task 4 (`OpenQueue` holds files until `markReady`).
2. Uppercase names like `_REPORT.PDF` must be accepted — pinned in Task 4 (`isOpenablePdf` test).
3. Reload/offline-retry after the page subscribed must not lose or duplicate queued files — pinned in Task 4 (`markNotReady` then `markReady` test).
4. Windows: several PDFs selected and opened together arrive as several argv paths, and a second launch passes argv to the first instance — pinned in Task 4 (`pdfPathsFromArgv` tests).
5. Stripe checkout/portal and other external links must open in the browser, not replace the app window — pinned in Task 4 (`navigationTarget` tests) and Task 5 smoke check.

Rulings against the spec: (1) window size/position memory is deferred — Electron defaults are fine for v1, cost if wrong: one small follow-up; (2) the PR smoke test launches the built source (`electron .`), not the packaged installer, because launching the universal `.app`/NSIS install headlessly on CI is brittle — the packaged layout is checked by the Task 6 Info.plist step and the manual first run.

Known limitation (not built here, recorded for the accounts launch): Google blocks OAuth sign-in inside embedded browsers and magic-link emails open in the system browser, so Clerk sign-in inside the desktop app needs its own design before `PAYWALL_ENABLED` is turned on. Task 7 adds this to `docs/accounts-setup.md`.

---

### Task 1: Rename the visible app to SentinelPDF

**Files:**
- Modify: `index.html` (lines 19, 22), `public/manifest.webmanifest` (lines 2–3), `public/sw.js` (line 1 comment only), `public/terms.html` (title, back link, every visible "PDF Studio", version text lines 47 and 93), `src/components/DropZone.tsx:37`, `src/components/DefaultAppDialog.tsx:16,18`, `src/components/DefaultAppPrompt.tsx:14`, `src/components/InstallButton.tsx:34,36`, `src/pwa/defaultApp.ts:15,22`, `src/account/terms.ts` (lines 1–2), `src/components/account/TermsDialog.tsx:37`, `src/tokens.css:3`, `worker/src/terms.ts:1`, `worker/src/prompts/ask.ts`, `askRetrieved.ts`, `rewrite.ts`, `summarize.ts`, `worker/src/prompts/live.ts` (line 7 prompt text only — NOT line 2), `README.md`, `worker/README.md`
- Test: `src/components/DefaultAppPrompt.test.tsx:23`, `e2e/pwa.spec.ts:9`, `src/account/terms.page.test.ts` (unchanged, must still pass), new `src/brand.test.ts`

**Interfaces:**
- Produces: `TERMS_VERSION = "2026-10-15"` in both `src/account/terms.ts` and `worker/src/terms.ts`.

- [ ] **Step 1: Write the failing brand test** — `src/brand.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const VISIBLE = ["index.html", "public/manifest.webmanifest", "public/terms.html", "src/components/DropZone.tsx",
  "src/components/DefaultAppDialog.tsx", "src/components/DefaultAppPrompt.tsx", "src/components/InstallButton.tsx",
  "src/pwa/defaultApp.ts", "src/account/terms.ts", "src/components/account/TermsDialog.tsx"];

describe("brand", () => {
  it.each(VISIBLE)("%s says SentinelPDF, never PDF Studio", (p) => {
    const s = read(p);
    expect(s).not.toContain("PDF Studio");
    expect(s).toContain("SentinelPDF");
  });
  it("manifest keeps its id so installed copies stay the same app", () => {
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expect(m.id).toBe("/");
    expect(m.name).toBe("SentinelPDF");
    expect(m.short_name).toBe("SentinelPDF");
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/brand.test.ts` → FAIL (files still say PDF Studio).

- [ ] **Step 3: Replace the visible name.** In every file listed under Modify, replace `PDF Studio` with `SentinelPDF` in user-visible text and prompt text. Exceptions: leave `AGENT_NAME = "PDF Studio Voice"` in `worker/src/prompts/live.ts:2` and the `worker/test/provision.test.ts` fixtures untouched. In `public/sw.js` change only the line-1 comment; do not change cache names. In `src/account/terms.ts` and `worker/src/terms.ts` set `TERMS_VERSION = "2026-10-15"`; in `public/terms.html` replace both `2026-10-12` occurrences with `2026-10-15`. Update `DefaultAppPrompt.test.tsx:23` to `"Make SentinelPDF your default PDF app?"` and `e2e/pwa.spec.ts:9` to `"SentinelPDF"`. Then run `grep -rn "PDF Studio" src public index.html worker/src e2e README.md` — the only remaining hit must be `worker/src/prompts/live.ts:2`.

- [ ] **Step 4: Run checks** — `npx vitest run src/brand.test.ts` PASS; `npm run lint && npm run build && npm test` PASS; `npm --prefix worker test` PASS (fix any worker test that asserted the old prompt wording or version by updating its expected string).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: rename the app to SentinelPDF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Desktop bridge in the web app

**Files:**
- Create: `src/desktop/bridge.ts`, `src/desktop/bridge.test.ts`
- Modify: `src/App.tsx` (after the `launchQueue` effect, ~line 117), `src/components/InstallButton.tsx`, `src/components/DefaultAppButton.tsx`, `src/components/DefaultAppPrompt.tsx`
- Test: `src/components/InstallButton.test.tsx`, `src/components/DefaultAppButton.test.tsx`, `src/components/DefaultAppPrompt.test.tsx` (add one case each)

**Interfaces:**
- Produces (web side of the IPC contract that Task 4/5 implement):

```ts
export interface DesktopFile { name: string; bytes: Uint8Array }
export interface DesktopBridge { version: string; onOpenFile(cb: (f: DesktopFile) => void): () => void }
export function desktopBridge(): DesktopBridge | null;   // window.sentinelDesktop ?? null
export function isDesktop(): boolean;
export function subscribeDesktopFiles(onFiles: (files: File[]) => void): () => void; // no-op unsubscribe when no bridge
```

- [ ] **Step 1: Write the failing tests** — `src/desktop/bridge.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { desktopBridge, isDesktop, subscribeDesktopFiles, type DesktopFile } from "./bridge";

type W = Window & { sentinelDesktop?: unknown };
afterEach(() => { delete (window as W).sentinelDesktop; });

describe("desktop bridge", () => {
  it("is absent in a normal browser", () => {
    expect(desktopBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
    const off = subscribeDesktopFiles(vi.fn());
    expect(() => off()).not.toThrow();
  });

  it("turns opened files into File objects and unsubscribes", async () => {
    let handler: ((f: DesktopFile) => void) | null = null;
    const unsub = vi.fn();
    (window as W).sentinelDesktop = { version: "1.0.0", onOpenFile: (cb: (f: DesktopFile) => void) => { handler = cb; return unsub; } };
    expect(isDesktop()).toBe(true);
    const got = vi.fn();
    const off = subscribeDesktopFiles(got);
    handler!({ name: "_REPORT.PDF", bytes: new Uint8Array([37, 80, 68, 70]) });
    const files = got.mock.calls[0][0] as File[];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("_REPORT.PDF");
    expect(files[0].type).toBe("application/pdf");
    expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    off();
    expect(unsub).toHaveBeenCalled();
  });
});
```

In each of `InstallButton.test.tsx`, `DefaultAppButton.test.tsx`, `DefaultAppPrompt.test.tsx` add a case that sets `(window as Window & { sentinelDesktop?: unknown }).sentinelDesktop = { version: "1", onOpenFile: () => () => {} }` with the store/UA state that would otherwise show the component, renders it, asserts `container.innerHTML === ""`, and deletes `sentinelDesktop` afterwards.

- [ ] **Step 2: Run** — `npx vitest run src/desktop src/components/InstallButton.test.tsx src/components/DefaultApp` → FAIL.

- [ ] **Step 3: Implement** — `src/desktop/bridge.ts`:

```ts
export interface DesktopFile { name: string; bytes: Uint8Array }
export interface DesktopBridge { version: string; onOpenFile(cb: (f: DesktopFile) => void): () => void }

/** The Electron preload exposes window.sentinelDesktop; absent in normal browsers. */
export const desktopBridge = (): DesktopBridge | null =>
  typeof window === "undefined" ? null : ((window as Window & { sentinelDesktop?: DesktopBridge }).sentinelDesktop ?? null);

export const isDesktop = (): boolean => desktopBridge() !== null;

export function subscribeDesktopFiles(onFiles: (files: File[]) => void): () => void {
  const bridge = desktopBridge();
  if (!bridge) return () => {};
  return bridge.onOpenFile(({ name, bytes }) => onFiles([new File([bytes], name, { type: "application/pdf" })]));
}
```

In `src/App.tsx`, import `subscribeDesktopFiles` from `./desktop/bridge` and add directly after the `launchQueue` effect:

```tsx
  // Desktop app: PDFs opened from Finder/Explorer arrive through the Electron preload bridge.
  useEffect(() => subscribeDesktopFiles((files) => { void handleFiles(files, "open"); }), [handleFiles]);
```

In `InstallButton.tsx`, `DefaultAppButton.tsx` and `DefaultAppPrompt.tsx`, import `isDesktop` from `../desktop/bridge` and add `if (isDesktop()) return null;` as the first line of the component body after hooks (keep hook order stable: place it right before the existing early `return null` check, combining conditions).

- [ ] **Step 4: Run** — same vitest command PASS; `npm run lint && npm run build && npm test` PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(desktop): open PDFs passed in by the desktop app; hide install prompts there"` (with the Co-Authored-By trailer).

---

### Task 3: Download page and links

**Files:**
- Create: `public/download.html`, `src/download.page.test.ts`
- Modify: `src/components/DefaultAppDialog.tsx`, `src/components/InstallButton.tsx` (safari-mac help)
- Test: `src/components/DefaultAppButton.test.tsx`, `src/components/InstallButton.test.tsx`

**Interfaces:**
- Produces: `DOWNLOAD_URL = "/download"` exported from `src/pwa/defaultApp.ts`; release URLs `https://github.com/shemaiah7/pdfstudio/releases/latest/download/SentinelPDF-mac.dmg` and `.../SentinelPDF-windows.exe`.

- [ ] **Step 1: Write the failing test** — `src/download.page.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(__dirname, "../public/download.html"), "utf8");
const REL = "https://github.com/shemaiah7/pdfstudio/releases/latest/download/";

describe("public/download.html", () => {
  it("links both installers", () => {
    expect(html).toContain(`${REL}SentinelPDF-mac.dmg`);
    expect(html).toContain(`${REL}SentinelPDF-windows.exe`);
  });
  it("names the app and explains the Windows warning and requirements", () => {
    expect(html).toContain("<title>Download SentinelPDF</title>");
    expect(html).toContain("More info");
    expect(html).toContain("Run anyway");
    expect(html).toContain("macOS 12");
    expect(html).toContain("Windows 10");
  });
  it("supports dark mode and phones", () => {
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('name="viewport"');
  });
});
```

Add to `DefaultAppButton.test.tsx` (dialog open case): `expect(screen.getByRole("link", { name: "Get the desktop app" }).getAttribute("href")).toBe("/download");`. Add to the `InstallButton.test.tsx` safari-mac case the same assertion.

- [ ] **Step 2: Run** — `npx vitest run src/download.page.test.ts src/components` → FAIL.

- [ ] **Step 3: Implement.** Create `public/download.html` by copying the `<head>`/style approach of `public/terms.html` (same fonts, colour variables, light/dark media query, back link `&larr; Back to SentinelPDF`). Body content:
  - `<h1>Get SentinelPDF for your computer</h1>` and a one-line lede: "Open PDFs from Finder or File Explorer straight into SentinelPDF, like any desktop PDF app."
  - Two buttons (anchors) with ids `dl-mac` → `${REL}SentinelPDF-mac.dmg` ("Download for Mac") and `dl-win` → `${REL}SentinelPDF-windows.exe` ("Download for Windows").
  - A short inline `<script>` that, if `navigator.userAgent` contains `Windows`, moves `#dl-win` before `#dl-mac` (pure DOM, no storage).
  - Notes: "Mac: macOS 12 or later, Apple silicon or Intel. Signed and notarized by Apple." / "Windows: Windows 10 or later (64-bit). Windows may show “Windows protected your PC” the first time — click More info, then Run anyway."
  - "After installing, double-click any PDF and choose SentinelPDF, or follow the steps in the app to make it your default."
  In `src/pwa/defaultApp.ts` add `export const DOWNLOAD_URL = "/download";`. In `DefaultAppDialog.tsx`, after the help paragraph add `<p className="installHelp"><a href={DOWNLOAD_URL}>Get the desktop app</a> to open PDFs without a browser.</p>`. In `InstallButton.tsx` for the `safari-mac` hint render, below the help text, `<p className="installHelp"><a href={DOWNLOAD_URL}>Get the desktop app</a> — Safari web apps can't open PDFs from Finder.</p>` (only for `safari-mac`).

- [ ] **Step 4: Run** — vitest PASS; `npm run lint && npm run build && npm test` PASS. `npm run build` then confirm `dist/download.html` exists.

- [ ] **Step 5: Commit** — `feat: download page for the desktop app` (with trailer).

---

### Task 4: Desktop shell rules (pure, tested)

**Files:**
- Create: `desktop/package.json`, `desktop/tsconfig.json`, `desktop/vitest.config.ts`, `desktop/src/config.ts`, `desktop/src/rules.ts`, `desktop/src/openQueue.ts`, `desktop/test/rules.test.ts`, `desktop/test/openQueue.test.ts`, `desktop/.gitignore`
- Modify: root `.oxlintrc.json` only if oxlint fails on `desktop/` (add `"ignorePatterns": ["desktop/dist", "desktop/release"]`)

**Interfaces:**
- Produces:

```ts
// config.ts
export const APP_URL: string;            // "https://pdfstudio.shemaiah7.workers.dev" until Task 7
export const APP_ORIGINS: string[];      // origins allowed in the window
export const MAX_PDF_BYTES = 209715200;
// rules.ts
export type NavTarget = "app" | "external" | "block";
export function navigationTarget(url: string, origins: string[]): NavTarget;
export function allowPermission(permission: string, requestingUrl: string, origins: string[]): boolean;
export function isOpenablePdf(path: string, size: number): boolean;
export function pdfPathsFromArgv(argv: string[]): string[];
// openQueue.ts
export interface QueuedFile { name: string; bytes: Uint8Array }
export class OpenQueue {
  constructor(deliver: (f: QueuedFile) => void);
  push(f: QueuedFile): void;   // delivers now if ready, else holds
  markReady(): void;           // flushes held files in order, then delivers directly
  markNotReady(): void;        // page navigated/reloaded; hold again
}
```

- [ ] **Step 1: Scaffold.** `desktop/package.json`:

```json
{
  "name": "sentinelpdf-desktop",
  "productName": "SentinelPDF",
  "version": "1.0.0",
  "private": true,
  "description": "SentinelPDF desktop app",
  "author": "SentinelPDF",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder",
    "dist:dir": "npm run build && electron-builder --dir --config.mac.notarize=false"
  }
}
```

Then `cd desktop && npm install --save-dev electron electron-builder typescript vitest @playwright/test && npm install electron-updater` (latest versions; commit the lockfile). `desktop/tsconfig.json`:

```json
{ "compilerOptions": { "target": "ES2022", "module": "commonjs", "moduleResolution": "node", "outDir": "dist", "rootDir": "src", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "types": ["node"] }, "include": ["src"] }
```

`desktop/vitest.config.ts`: `import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });`. `desktop/.gitignore`: `node_modules/`, `dist/`, `release/`.

`desktop/src/config.ts`:

```ts
/** Where the desktop window points. Flip to https://sentinelpdf.com once the domain is live (plan Task 7). */
export const APP_URL = "https://pdfstudio.shemaiah7.workers.dev";
export const APP_ORIGINS = ["https://pdfstudio.shemaiah7.workers.dev", "https://sentinelpdf.com", "https://www.sentinelpdf.com"];
export const MAX_PDF_BYTES = 209715200;
export const RELEASES_OWNER = "shemaiah7";
export const RELEASES_REPO = "pdfstudio";
```

- [ ] **Step 2: Write the failing tests** — `desktop/test/rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { navigationTarget, allowPermission, isOpenablePdf, pdfPathsFromArgv } from "../src/rules";
import { APP_ORIGINS, MAX_PDF_BYTES } from "../src/config";

describe("navigationTarget", () => {
  it("keeps app pages in the window", () => {
    expect(navigationTarget("https://pdfstudio.shemaiah7.workers.dev/", APP_ORIGINS)).toBe("app");
    expect(navigationTarget("https://sentinelpdf.com/terms", APP_ORIGINS)).toBe("app");
  });
  it("sends other web links to the browser", () => {
    expect(navigationTarget("https://checkout.stripe.com/c/pay/cs_test", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("https://billing.stripe.com/p/session/x", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("http://example.com", APP_ORIGINS)).toBe("external");
  });
  it("blocks look-alikes and non-web schemes", () => {
    expect(navigationTarget("https://sentinelpdf.com.evil.io/", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("http://sentinelpdf.com/", APP_ORIGINS)).toBe("external");
    expect(navigationTarget("file:///etc/passwd", APP_ORIGINS)).toBe("block");
    expect(navigationTarget("javascript:alert(1)", APP_ORIGINS)).toBe("block");
    expect(navigationTarget("not a url", APP_ORIGINS)).toBe("block");
  });
});

describe("allowPermission", () => {
  it("grants the microphone to the app only", () => {
    expect(allowPermission("media", "https://sentinelpdf.com/", APP_ORIGINS)).toBe(true);
    expect(allowPermission("media", "https://evil.io/", APP_ORIGINS)).toBe(false);
  });
  it("denies everything else", () => {
    for (const p of ["geolocation", "notifications", "camera", "midi", "openExternal"]) {
      expect(allowPermission(p, "https://sentinelpdf.com/", APP_ORIGINS)).toBe(false);
    }
  });
});

describe("isOpenablePdf", () => {
  it("accepts .pdf in any case up to 200 MB", () => {
    expect(isOpenablePdf("/Users/a/_REPORT.PDF", 1000)).toBe(true);
    expect(isOpenablePdf("C:\\Docs\\form.pdf", MAX_PDF_BYTES)).toBe(true);
  });
  it("rejects other types, empty and oversized files", () => {
    expect(isOpenablePdf("/a/notes.txt", 10)).toBe(false);
    expect(isOpenablePdf("/a/x.pdf.exe", 10)).toBe(false);
    expect(isOpenablePdf("/a/x.pdf", 0)).toBe(false);
    expect(isOpenablePdf("/a/x.pdf", MAX_PDF_BYTES + 1)).toBe(false);
  });
});

describe("pdfPathsFromArgv", () => {
  it("picks PDF paths and ignores the executable and flags", () => {
    expect(pdfPathsFromArgv(["C:\\Program Files\\SentinelPDF\\SentinelPDF.exe", "--allow-file-access", "C:\\a\\one.pdf", "C:\\b\\TWO.PDF"]))
      .toEqual(["C:\\a\\one.pdf", "C:\\b\\TWO.PDF"]);
  });
  it("returns nothing when no PDF was passed", () => {
    expect(pdfPathsFromArgv(["/Applications/SentinelPDF.app/Contents/MacOS/SentinelPDF", "-psn_0_12345"])).toEqual([]);
  });
});
```

`desktop/test/openQueue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { OpenQueue } from "../src/openQueue";

const f = (name: string) => ({ name, bytes: new Uint8Array([1]) });

describe("OpenQueue", () => {
  it("holds files until the page is ready, then delivers in order", () => {
    const deliver = vi.fn();
    const q = new OpenQueue(deliver);
    q.push(f("a.pdf")); q.push(f("b.pdf"));
    expect(deliver).not.toHaveBeenCalled();
    q.markReady();
    expect(deliver.mock.calls.map((c) => c[0].name)).toEqual(["a.pdf", "b.pdf"]);
  });
  it("delivers immediately once ready", () => {
    const deliver = vi.fn();
    const q = new OpenQueue(deliver);
    q.markReady(); q.push(f("c.pdf"));
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("after a reload, holds again and never duplicates", () => {
    const deliver = vi.fn();
    const q = new OpenQueue(deliver);
    q.markReady(); q.push(f("a.pdf"));
    q.markNotReady(); q.push(f("b.pdf"));
    expect(deliver).toHaveBeenCalledTimes(1);
    q.markReady(); q.markReady();
    expect(deliver.mock.calls.map((c) => c[0].name)).toEqual(["a.pdf", "b.pdf"]);
  });
});
```

- [ ] **Step 3: Run** — `cd desktop && npx vitest run` → FAIL (modules missing).

- [ ] **Step 4: Implement** — `desktop/src/rules.ts`:

```ts
import { MAX_PDF_BYTES } from "./config";

export type NavTarget = "app" | "external" | "block";

export function navigationTarget(url: string, origins: string[]): NavTarget {
  let u: URL;
  try { u = new URL(url); } catch { return "block"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "block";
  return origins.includes(u.origin) ? "app" : "external";
}

export function allowPermission(permission: string, requestingUrl: string, origins: string[]): boolean {
  if (permission !== "media") return false;
  try { return origins.includes(new URL(requestingUrl).origin); } catch { return false; }
}

export function isOpenablePdf(path: string, size: number): boolean {
  return /\.pdf$/i.test(path) && size > 0 && size <= MAX_PDF_BYTES;
}

export function pdfPathsFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith("-") && /\.pdf$/i.test(a));
}
```

`desktop/src/openQueue.ts`:

```ts
export interface QueuedFile { name: string; bytes: Uint8Array }

/** Holds opened files until the page has subscribed, so launches and reloads never drop or repeat a file. */
export class OpenQueue {
  private held: QueuedFile[] = [];
  private ready = false;
  constructor(private readonly deliver: (f: QueuedFile) => void) {}
  push(f: QueuedFile): void { if (this.ready) this.deliver(f); else this.held.push(f); }
  markReady(): void {
    this.ready = true;
    const pending = this.held; this.held = [];
    for (const f of pending) this.deliver(f);
  }
  markNotReady(): void { this.ready = false; }
}
```

- [ ] **Step 5: Run** — `cd desktop && npx vitest run` PASS; `npm run build` (desktop) compiles. From the root: `npm run lint` still passes.

- [ ] **Step 6: Commit** — `feat(desktop): navigation, permission and file-open rules` (with trailer).

---

### Task 5: Electron main, preload and offline screen

**Files:**
- Create: `desktop/src/main.ts`, `desktop/src/preload.ts`, `desktop/offline.html`, `desktop/test/smoke.e2e.ts`, `desktop/playwright.config.ts`
- Modify: `desktop/package.json` (add `"e2e": "playwright test"`)

**Interfaces:**
- Consumes: everything Task 4 produces; the web contract from Task 2 (`window.sentinelDesktop = { version, onOpenFile }`).
- Produces IPC channels: `"sentinel:open-file"` (main → page, payload `QueuedFile`), `"sentinel:ready"` (page → main, no payload).

- [ ] **Step 1: Write the smoke test** — `desktop/playwright.config.ts`: `import { defineConfig } from "@playwright/test"; export default defineConfig({ testDir: "test", testMatch: "*.e2e.ts", timeout: 60000 });`. `desktop/test/smoke.e2e.ts`:

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

test("the window loads the app with the bridge", async () => {
  const app = await electron.launch({ args: [resolve(__dirname, "..")] });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe("SentinelPDF");
  expect(win.url()).toMatch(/^https:\/\//);
  expect(await win.evaluate(() => typeof (window as unknown as { sentinelDesktop?: { version: string } }).sentinelDesktop?.version)).toBe("string");
  expect(await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined");
  await app.close();
});
```

- [ ] **Step 2: Run** — `cd desktop && npm run build && npx playwright test` → FAIL (no main.js).

- [ ] **Step 3: Implement** — `desktop/src/preload.ts` (sandboxed preloads cannot read `process.env`; the version arrives as an extra argv flag set by main):

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type OpenedFile = { name: string; bytes: Uint8Array };
const listeners = new Set<(f: OpenedFile) => void>();
ipcRenderer.on("sentinel:open-file", (_e: IpcRendererEvent, f: OpenedFile) => { for (const cb of listeners) cb(f); });
const version = process.argv.find((a) => a.startsWith("--sentinel-version="))?.split("=")[1] ?? "";

contextBridge.exposeInMainWorld("sentinelDesktop", {
  version,
  onOpenFile(cb: (f: OpenedFile) => void) {
    listeners.add(cb);
    ipcRenderer.send("sentinel:ready");
    return () => { listeners.delete(cb); };
  },
  retry: () => ipcRenderer.send("sentinel:retry"),
});
```

Add `retry?: () => void` to the `DesktopBridge` interface in `src/desktop/bridge.ts`.

`desktop/src/main.ts`:

```ts
import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { autoUpdater } from "electron-updater";
import { APP_URL, APP_ORIGINS } from "./config";
import { allowPermission, isOpenablePdf, navigationTarget, pdfPathsFromArgv } from "./rules";
import { OpenQueue } from "./openQueue";

let win: BrowserWindow | null = null;
const queue = new OpenQueue((f) => win?.webContents.send("sentinel:open-file", f));

async function openPath(path: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!isOpenablePdf(path, s.size)) {
      await dialog.showMessageBox({ type: "info", message: "SentinelPDF can only open PDF files up to 200 MB." });
      return;
    }
    queue.push({ name: basename(path), bytes: new Uint8Array(await readFile(path)) });
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  } catch { /* unreadable file: ignore */ }
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv) => { for (const p of pdfPathsFromArgv(argv)) void openPath(p); win?.focus(); });
app.on("open-file", (e, path) => { e.preventDefault(); void openPath(path); }); // macOS; may fire before ready

function openExternal(url: string): void { if (navigationTarget(url, APP_ORIGINS) === "external") void shell.openExternal(url); }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 520, title: "SentinelPDF", show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--sentinel-version=${app.getVersion()}`],
    },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:") && url.endsWith("offline.html")) return;
    if (navigationTarget(url, APP_ORIGINS) !== "app") { e.preventDefault(); openExternal(url); }
  });
  win.webContents.on("did-start-navigation", (_e, _url, _inPlace, isMainFrame) => { if (isMainFrame) queue.markNotReady(); });
  win.webContents.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) void win?.loadFile(join(__dirname, "..", "offline.html"));
  });
  win.on("closed", () => { win = null; });
  void win.loadURL(APP_URL);
}

ipcMain.on("sentinel:ready", (e) => { if (win && e.sender === win.webContents) queue.markReady(); });
ipcMain.on("sentinel:retry", () => { void win?.loadURL(APP_URL); });

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowPermission(permission, wc.getURL(), APP_ORIGINS)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowPermission(permission, origin, APP_ORIGINS));
  createWindow();
  for (const p of pdfPathsFromArgv(process.argv)) void openPath(p); // Windows first launch
  if (app.isPackaged) {
    autoUpdater.on("error", () => {});
    autoUpdater.on("update-downloaded", async () => {
      const r = await dialog.showMessageBox({ type: "info", buttons: ["Restart to update", "Later"], defaultId: 0, message: "A SentinelPDF update is ready." });
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
    void autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => { void autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!win) createWindow(); });
```

`desktop/offline.html` — a self-contained page (inline CSS, light/dark via `prefers-color-scheme`, system font), centred text "You're offline." / "Reconnect to use SentinelPDF." and `<button id="retry">Retry</button>` wired as `<script>document.getElementById("retry").onclick = () => window.sentinelDesktop && window.sentinelDesktop.retry();</script>` (the preload also runs on this `file:` page, and main reloads `APP_URL` on `sentinel:retry`, so the URL lives only in `config.ts`).

- [ ] **Step 4: Run** — `cd desktop && npm run build && npx vitest run && npx playwright test` PASS (needs network). Manually: `npm start`, confirm the window shows the app; turn Wi-Fi off and relaunch → offline screen; Retry with Wi-Fi on → app.

- [ ] **Step 5: Commit** — `feat(desktop): Electron window, file opening, offline screen and updates` (with trailer).

---

### Task 6: Packaging, signing, CI and setup guide

**Files:**
- Create: `desktop/electron-builder.yml`, `desktop/build/entitlements.mac.plist`, `desktop/build/icon.png` (copy of `public/icons/icon-512.png`), `.github/workflows/desktop.yml`, `docs/desktop-setup.md`
- Test: CI run of `desktop.yml` on the PR (unsigned `--dir` builds + smoke)

- [ ] **Step 1: `desktop/electron-builder.yml`**

```yaml
appId: com.sentinelpdf.desktop
productName: SentinelPDF
directories: { output: release, buildResources: build }
files: [dist/**, offline.html, package.json]
fileAssociations:
  - ext: pdf
    name: PDF Document
    description: PDF Document
    mimeType: application/pdf
    role: Editor
mac:
  target:
    - { target: dmg, arch: universal }
    - { target: zip, arch: universal }
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true
  minimumSystemVersion: "12.0"
  artifactName: SentinelPDF-mac.${ext}
  extendInfo:
    NSMicrophoneUsageDescription: SentinelPDF uses the microphone for Voice, so you can ask about your document out loud.
win:
  target: [{ target: nsis, arch: x64 }]
  artifactName: SentinelPDF-windows.${ext}
nsis:
  oneClick: true
  perMachine: false
  deleteAppDataOnUninstall: false
publish:
  provider: github
  owner: shemaiah7
  repo: pdfstudio
  releaseType: release
```

- [ ] **Step 2: `desktop/build/entitlements.mac.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.network.client</key><true/>
</dict>
</plist>
```

Copy the icon: `cp public/icons/icon-512.png desktop/build/icon.png`.

- [ ] **Step 3: Local unsigned build** — `cd desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:dir`. Expected: `release/mac-universal/SentinelPDF.app` exists. Check file association: `/usr/libexec/PlistBuddy -c "Print :CFBundleDocumentTypes:0:CFBundleTypeExtensions" release/mac-universal/SentinelPDF.app/Contents/Info.plist` prints `pdf`; `... -c "Print :CFBundleIdentifier"` prints `com.sentinelpdf.desktop`.

- [ ] **Step 4: `.github/workflows/desktop.yml`**

```yaml
name: Desktop

on:
  push:
    tags: ["desktop-v*"]
  pull_request:
    paths: ["desktop/**", ".github/workflows/desktop.yml"]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: desktop
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: desktop/package-lock.json }
      - run: npm ci
      - run: npm test
      - name: Package (PR, unsigned)
        if: github.event_name == 'pull_request'
        run: npm run dist:dir -- --publish never
        env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
      - name: Smoke test (PR)
        if: github.event_name == 'pull_request'
        run: npx playwright test
      - name: Release (tag or manual)
        if: github.event_name != 'pull_request'
        run: npm run dist -- --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ matrix.os == 'macos-latest' && secrets.MAC_CERT_P12_BASE64 || '' }}
          CSC_KEY_PASSWORD: ${{ matrix.os == 'macos-latest' && secrets.MAC_CERT_PASSWORD || '' }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          CSC_IDENTITY_AUTO_DISCOVERY: ${{ matrix.os == 'macos-latest' && 'true' || 'false' }}
```

The smoke test launches the unpacked source (`electron .`) which exercises the same main/preload; that is sufficient for PRs.

- [ ] **Step 5: `docs/desktop-setup.md`** — owner-facing, numbered, click-by-click:
  1. Accept the updated Apple Developer Program License Agreement (developer.apple.com → Account) — notarization fails until it is accepted.
  2. Create a Developer ID Application certificate: Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority (save to disk) → developer.apple.com → Certificates → + → Developer ID Application (G2 Sub-CA) → upload the request → download and double-click the `.cer`.
  3. Export it: Keychain Access → My Certificates → "Developer ID Application: …" → Export → `.p12` with a strong password.
  4. Base64 it: `base64 -i DeveloperID.p12 | pbcopy`.
  5. App-specific password: account.apple.com → Sign-In and Security → App-Specific Passwords → generate "SentinelPDF notarization".
  6. Team ID: developer.apple.com → Account → Membership details.
  7. GitHub → shemaiah7/pdfstudio → Settings → Secrets and variables → Actions → New repository secret, five times: `MAC_CERT_P12_BASE64` (the pasted base64), `MAC_CERT_PASSWORD`, `APPLE_ID` (Apple ID email), `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
  8. Tell Claude "secrets are in"; Claude tags `desktop-v1.0.0`.
  9. Delete the local `.p12` and the CSR file afterwards.
  Plus a "Releasing a new desktop version" section: bump `desktop/package.json` version, merge, tag `desktop-vX.Y.Z`, wait for the Desktop workflow, check the Release has `SentinelPDF-mac.dmg`, `SentinelPDF-mac.zip`, `SentinelPDF-windows.exe`, `latest-mac.yml`, `latest.yml`.

- [ ] **Step 6: Push and verify** — commit `feat(desktop): installers, signing config and release workflow` (with trailer); the controller pushes and opens the PR; the Desktop workflow must pass on both OSes.

---

### Task 7: Domain cutover to sentinelpdf.com (run only when the Cloudflare zone shows Active)

**Files:**
- Modify: `wrangler.jsonc` (root), `worker/wrangler.jsonc` (vars), `desktop/src/config.ts`, `desktop/package.json` (version `1.0.1` if 1.0.0 was already released), `docs/accounts-setup.md` (desktop sign-in limitation), `docs/desktop-setup.md` (note the app URL)
- Test: `worker/test` (existing CORS tests must pass), `desktop/test/rules.test.ts` (unchanged; already covers sentinelpdf.com)

- [ ] **Step 1: Check the zone** — controller runs `curl -sI https://sentinelpdf.com` (expect a Cloudflare response, not Namecheap) or checks the dashboard; stop here if the zone is still Pending.

- [ ] **Step 2: Attach the domains** — root `wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "pdfstudio",
  "compatibility_date": "2026-09-01",
  "workers_dev": true,
  "routes": [
    { "pattern": "sentinelpdf.com", "custom_domain": true },
    { "pattern": "www.sentinelpdf.com", "custom_domain": true }
  ],
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" }
}
```

- [ ] **Step 3: Allow the new origin in the AI service** — `worker/wrangler.jsonc` vars:

```jsonc
    "ALLOWED_ORIGIN": "https://sentinelpdf.com,https://www.sentinelpdf.com,https://pdfstudio.shemaiah7.workers.dev",
    "TURNSTILE_HOSTNAMES": "sentinelpdf.com,www.sentinelpdf.com,pdfstudio.shemaiah7.workers.dev",
    "APP_URL": "https://sentinelpdf.com"
```

Confirm `TURNSTILE_HOSTNAMES` is parsed as a comma list (`grep -n TURNSTILE_HOSTNAMES worker/src`); if it is compared as a single string, change the check to split on commas and add a worker test for a second hostname. Run `npm --prefix worker test` PASS.

- [ ] **Step 4: Point the desktop app at the domain** — `desktop/src/config.ts`: `export const APP_URL = "https://sentinelpdf.com";` (keep all three origins). `cd desktop && npx vitest run` PASS.

- [ ] **Step 5: Record the desktop sign-in limitation** — append to `docs/accounts-setup.md` a "Desktop app" section: "Before turning on PAYWALL_ENABLED, design desktop sign-in: Google blocks OAuth inside embedded browsers and magic-link emails open in the system browser. Options: Clerk email-code sign-in inside the app, or a browser hand-off with a deep link."

- [ ] **Step 6: Commit** — `feat: serve SentinelPDF at sentinelpdf.com` (with trailer). Deploy order (controller, after merge and user go-ahead): worker first (`npm --prefix worker run deploy`), then app (`npm run deploy`), then verify `https://sentinelpdf.com` and `https://www.sentinelpdf.com` load, `POST https://pdfstudio-ai.shemaiah7.workers.dev/session` with `Origin: https://sentinelpdf.com` returns `access-control-allow-origin: https://sentinelpdf.com`, and workers.dev still loads. Then tag `desktop-v1.0.x`.
