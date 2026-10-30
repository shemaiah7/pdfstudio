# Browser extension — design

Date: 2026-10-30. Status: approved in conversation (chat description); how-it-gets-made calls below are the coordinator's.
Builds on: `public/manifest.webmanifest` (PWA file handlers), `src/desktop/bridge.ts` (the desktop file hand-off pattern this mirrors).

## Problem

On a locked-down work computer the user can open sentinelpdf.com but cannot install software. Adobe's Acrobat extension makes PDFs opened in the browser land in Acrobat's web viewer instead of Chrome's built-in one. SentinelPDF should offer the same: a Chrome/Edge extension that sends PDFs the user opens in the browser to sentinelpdf.com, with no download or installer.

## Goals

- A PDF link clicked in Chrome or Edge opens in SentinelPDF instead of the built-in viewer (when the user has the extension and leaves the default on).
- Any page or link can be sent to SentinelPDF on demand (toolbar button, right-click menu), including local `file://` PDFs once the user allows file access.
- Works with PDFs behind a login the browser is already signed in to (intranet portals), as far as the browser allows.
- One package that both the Chrome Web Store and Edge Add-ons accept.
- The web app degrades gracefully: landing on an `#open=` link without the extension shows a clear message, never a spinner.

## Non-goals

- Firefox or Safari.
- Detecting PDFs served without a `.pdf` URL automatically (the on-demand button covers them). MV3 store extensions cannot block on `Content-Type`.
- Publishing to the stores. This change delivers the package, the listing copy, and the steps; the store submission is a human step.
- Any change to the Electron desktop app.

## Anti-goals (would make it a failure even if it "works")

- The web page fetching the PDF URL itself. Only the extension's background worker fetches. The page never navigates to or fetches a URL it was handed (SSRF / phishing surface, and CORS would break it anyway).
- The PDF URL reaching SentinelPDF's servers. It rides in the URL fragment, which browsers never send.
- Any telemetry, analytics or third-party request from the extension.
- A redirect loop: opening a `.pdf` URL that turns out not to be a PDF must end in a message with a way out, never bounce.
- Breaking non-PDF browsing. The automatic rule only matches main-frame navigations whose path ends in `.pdf`.

## Decisions

### D1. Where the code lives

A sibling package `extension/` next to `desktop/`, plain Manifest V3 files, no bundler, ES modules:

```
extension/
  manifest.json
  background.js      service worker (type: module)
  content.js         runs only on the SentinelPDF origin(s)
  lib.js             pure helpers shared by background/content, unit-tested
  lib.test.js        vitest (node)
  popup.html / popup.js / popup.css
  icons/             16, 32, 48, 128 png derived from public/icons/icon-512.png
  README.md          what it does, load-unpacked steps, file-URL step, store submission steps
  STORE.md           listing copy + permission justifications (both stores)
```

Not under `public/` (Vite would ship it on the site) and not under `src/` (keeps the web bundle clean). Root `vitest.config.ts` gains `extension/**/*.test.js` in `include`. Root `package.json` gains `"extension:pack": "sh scripts/pack-extension.sh"` which zips `extension/` (minus tests and README/STORE) to `extension/dist/sentinelpdf-extension-<version>.zip`; `extension/dist` is gitignored. Version starts at `1.0.0` in `manifest.json`.

### D2. Permissions (coordinator's call)

`host_permissions: ["<all_urls>"]`. The background worker must fetch the PDF bytes from any host, with the browser's cookies, because the page cannot (CORS) and the browser's built-in viewer is what we're replacing. This shows Chrome's "read and change all your data on all websites" warning and slows store review; there is no narrower permission that works for arbitrary PDF hosts. Adobe's extension asks for the same.

`permissions: ["declarativeNetRequest", "storage", "contextMenus", "tabs"]`. `tabs` is for the active tab's URL in the popup and `tabs.update/create`. No `webRequest`, no `notifications`, no `scripting`.

### D3. Hand-off URL

The extension sends the browser to `<APP_ORIGIN>/#open=<original URL>` (raw, not encoded; the original URL contains no `#` because DNR matches URLs without fragments, so everything after `#open=` is the URL). `APP_ORIGIN` defaults to `https://sentinelpdf.com` and can be overridden with `chrome.storage.local.appOrigin` (dev and e2e only, never surfaced in UI). `src/ai/owner.ts` already strips `#owner=`; `#open=` is handled by the page bridge (D6) and must not conflict.

### D4. Automatic interception (Flow A)

A **dynamic** declarativeNetRequest redirect rule (not a static ruleset, so the origin override and the toggle both just rebuild it):

- `condition`: `regexFilter: "^https?://.*\\.pdf(\\?.*)?$"` with `isUrlFilterCaseSensitive: false`, `resourceTypes: ["main_frame"]`, `excludedRequestDomains: [<APP_ORIGIN host>]`.
- `action`: `redirect.regexSubstitution: "<APP_ORIGIN>/#open=\\0"`.

`ensureRules()` runs on `runtime.onInstalled`, `runtime.onStartup` and whenever `storage.onChanged` touches `autoOpen` or `appOrigin`: it removes the rule when `autoOpen` (storage.sync, default `true`) is false, else (re)adds it. Known side effect, accepted: `.pdf` links meant as downloads open in SentinelPDF while the toggle is on. `file://` is not matched by the rule; the on-demand paths cover it.

### D5. On demand (Flow B)

All on-demand paths just navigate to the hand-off URL; the same content-script code (D7) then does the work.

- Toolbar popup: a checkbox "Open PDF links in SentinelPDF automatically" (bound to `autoOpen`) and a button "Open this page in SentinelPDF" (the active tab's URL, same tab; disabled with a hint for `chrome://`, `edge://`, `about:` and the app origin itself). A one-line note: "For PDFs on your computer, turn on 'Allow access to file URLs' in the extension's details."
- Context menu `link` context: "Open link in SentinelPDF" → new tab next to the current one.
- Context menu `page` context: "Open this page in SentinelPDF" → same tab. (Chrome's built-in PDF viewer may not surface page context menus; the toolbar button is the reliable path there.)

### D6. Web app side — `src/extension/bridge.ts` (mirrors `src/desktop/bridge.ts`)

Pure functions plus one subscription, all unit-tested in jsdom like `bridge.test.ts`:

- `pendingOpenUrl(hash = location.hash): string | null` — the text after `#open=`, or null.
- `clearOpenHash()` — `history.replaceState` to the same URL without the fragment.
- `subscribeExtensionBridge(handlers)` with `onFetching(name)`, `onFiles(File[])`, `onError(message)`; returns unsubscribe. Listens to `window` `message` events and accepts only `e.source === window && e.origin === location.origin` with `e.data.type` one of:
  - `sentinelpdf:ping` → reply `window.postMessage({ type: "sentinelpdf:ready" }, location.origin)`.
  - `sentinelpdf:fetching` `{ url }` → `onFetching(fileNameFrom(url))`.
  - `sentinelpdf:open-file` `{ name, bytes: ArrayBuffer }` → `onFiles([new File([bytes], name, { type: "application/pdf" })])`.
  - `sentinelpdf:open-error` `{ reason, url }` → `onError(messageFor(reason))`.
  On subscribe it also posts `sentinelpdf:ready` once (the content script may have pinged before the listener existed).
- `messageFor(reason)`: `not-pdf` → "That link isn't a PDF." · `file-access` → "SentinelPDF can't read files on your computer until you turn on “Allow access to file URLs” for the extension." · `http-<status>` → "Couldn't fetch the PDF (HTTP <status>). Open it the usual way and use the SentinelPDF button on that page." · `network` → "Couldn't fetch the PDF. Check the link or your connection." · anything else → a generic fallback.
- `watchPendingOpen(onTimeout, ms = 8000)`: if `pendingOpenUrl()` is non-null, starts a timer; returns `{ cancel }`. Timeout message: "Couldn't reach the SentinelPDF browser extension. Install it, or open the PDF the usual way." (No install link yet; export `EXTENSION_INSTALL_URL: string | null = null` for when the listing exists.)

`App.tsx` wiring, next to the desktop effect: subscribe; `onFetching` → `useToolsStore.setMessage("Opening <name>…")`; `onFiles` → `openDesktopBatch(files, isDirty, window.confirm, f => handleFiles(f, "open"))` (the dirty-check helper is generic; reuse it unchanged) then `clearOpenHash()` and clear the message; `onError` → `setError(msg)`, `clearOpenHash()`; `watchPendingOpen` → `setError(timeout msg)`, `clearOpenHash()`; the `fetching` message cancels the timeout watcher.

The error banner for `not-pdf` and `http-*` gets one more affordance: a "Open it without SentinelPDF" button that posts `{ type: "sentinelpdf:open-original", url }` to the window (D7 handles it). Implement by extending `ErrorBanner` to render an optional action from the document store (`error` becomes `{ text, action?: { label, run } } | string`, or a sibling field; builder's choice, keep existing `setError(string)` callers working).

### D7. Content script — `content.js` (runs on `https://sentinelpdf.com/*`, `https://www.sentinelpdf.com/*`, `http://localhost/*`, `http://127.0.0.1/*`, `document_idle`)

1. On start: register the `window` `message` listener (for `sentinelpdf:ready` and `sentinelpdf:open-original`), post `sentinelpdf:ping`.
2. If `location.hash` starts with `#open=`: take the raw remainder as `url`; post `sentinelpdf:fetching { url }`; open a `chrome.runtime.connect({ name: "fetch" })` port and send `{ url }`.
3. Port messages from the background: `{ type: "meta", name, size }`, `{ type: "chunk", data }` (base64 of ≤ 2 MiB raw), `{ type: "done" }`, `{ type: "error", reason }`. Decode chunks into `Uint8Array` parts; on `done` concatenate into one `ArrayBuffer`, wait until the page has said `ready` (buffer if not yet), then `window.postMessage({ type: "sentinelpdf:open-file", name, bytes }, location.origin, [bytes])`. On `error`, post `sentinelpdf:open-error { reason, url }`.
4. `sentinelpdf:open-original { url }` → `chrome.runtime.sendMessage({ type: "open-original", url })`.

MV3 messaging is JSON-only: `ArrayBuffer`s do not survive `runtime` messages, hence base64 chunks. A content script's own `fetch` runs under the page origin and hits CORS; only the background may fetch. Do not simplify either.

### D8. Background — `background.js`

- `onConnect` port `fetch`: `fetch(url, { credentials: "include", redirect: "follow" })`. `file:` URLs: if `chrome.extension.isAllowedFileSchemeAccess()` is false → `error file-access`; a thrown fetch → `error network` (for `file:` map to `file-access`); `!res.ok` → `error http-<status>`. Read the body; it is a PDF if `Content-Type` contains `pdf` or the first 1024 bytes contain `%PDF-`; otherwise `error not-pdf`. Name: `Content-Disposition` filename if present, else last path segment (decoded), else `document.pdf`; ensure `.pdf` suffix. Stream `meta`, `chunk`s, `done`. Disconnect aborts the fetch (`AbortController`).
- `onMessage` `open-original { url }` from the content script: disable the DNR rule, `tabs.update(sender.tab.id, { url })`, then `ensureRules()` again after `webNavigation`-free delay of 5 s (`setTimeout` in the worker is acceptable here; if the worker is killed first, `onStartup`/`onInstalled` restore the rule).
- `onMessage` `open-url { url, how: "same-tab" | "new-tab" }` from the popup; `contextMenus.onClicked` for the two menus (D5). Both build `<APP_ORIGIN>/#open=<url>` and `tabs.update` / `tabs.create({ index: tab.index + 1 })`.
- `ensureRules()` (D4). `appOrigin()` reads the override.
- `onInstalled`: create the context menus, `ensureRules()`.

### D9. Dev and testing

- Unit: `extension/lib.test.js` for `isPdfBytes`, `fileNameFrom(url, contentDisposition)`, `handoffUrl(origin, url)`, `buildRule(origin)`, base64 encode/decode round-trip of odd sizes. `src/extension/bridge.test.ts` for every function in D6 (postMessage with a wrong origin/source is ignored; `ready` is replied to `ping`; timeout fires only with a pending hash and is cancelled by `fetching`).
- E2E `e2e/extension.spec.ts`: `chromium.launchPersistentContext` with `channel: "chromium"`, `--disable-extensions-except`/`--load-extension` pointing at `extension/`. Get the service worker (`context.serviceWorkers()[0] ?? waitForEvent("serviceworker")`) and `sw.evaluate` to set `appOrigin` to `http://localhost:5199` (rules rebuild on the storage change). Then: (a) navigate to a `.pdf` URL the dev server serves (Vite serves repo files under their root-relative path; the e2e suite already has fixture PDFs — find how `e2e/*.spec.ts` reference them) and expect the URL to become `http://localhost:5199/#open=…` and a page to render; (b) navigate directly to `#open=<non-pdf URL>` and expect the "isn't a PDF" banner; (c) set `autoOpen` false and expect the `.pdf` URL to stay put. Keep it in its own file so the extension context doesn't affect other specs. If headless extension loading is flaky in CI, keep the spec and skip it with `test.skip(!!process.env.CI, "reason")` rather than deleting it.
- Manual: `extension/README.md` load-unpacked steps; the coder runs through them once in a real Chromium if one is available and notes the result in the PR.
- `public/privacy.html` gains a short "Browser extension" paragraph: fetches only the PDF you asked to open, hands it to the page, stores one setting, sends nothing elsewhere.

### D10. Store listing (`extension/STORE.md`, text only, not submitted here)

Name "SentinelPDF — open PDFs in SentinelPDF". Summary ≤ 132 chars. Description. Single purpose statement. Permission justifications: `<all_urls>` (fetch the PDF you open, with your login, from any site), `declarativeNetRequest` (send `.pdf` pages to SentinelPDF), `storage` (the on/off setting), `contextMenus`, `tabs`. Privacy policy URL `https://sentinelpdf.com/privacy.html`. Steps: Chrome Web Store developer dashboard (one-time $5 fee), upload zip, fill the above, submit; Edge Partner Center, same zip. Note that the extension ID becomes known only after the first upload.

## Left to the builder

Popup styling (plain, system font, light/dark via `prefers-color-scheme`), icon generation (`sips` on macOS is fine), exact base64 chunk size within the stated bound, test fixture choice, the `ErrorBanner` action shape, and wording polish within the messages given.

## Acceptance

- `npm run lint`, `npm test`, `npm run build` pass; `npm run e2e -- extension.spec.ts` passes locally (or is skipped in CI with a stated reason).
- Loading `extension/` unpacked in Chromium and visiting any public `.pdf` URL opens it in the app at `appOrigin`; the popup toggle turns that off; the toolbar button opens the current page; a non-PDF `.pdf` URL shows the banner with a working "Open it without SentinelPDF".
- Visiting `https://sentinelpdf.com/#open=https://example.com/x.pdf` without the extension shows the "Couldn't reach the extension" banner within ~8 s and the hash is cleared.
- `npm run extension:pack` produces the zip.
