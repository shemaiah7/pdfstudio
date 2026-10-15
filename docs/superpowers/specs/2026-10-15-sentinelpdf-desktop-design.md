# SentinelPDF rename and desktop installers — design

Date: 2026-10-15. Status: approved in conversation (sections 1–3); awaiting written-spec review.

## Goal

Ship SentinelPDF (today "PDF Studio") as real Mac and Windows desktop apps that register as a PDF handler like Acrobat, under the new name and, once bought, the domain sentinelpdf.com.

## Decisions (from the user)

- Name: **SentinelPDF**. Domain **sentinelpdf.com** (the user buys it; .com only). Trademark: no exact SENTINEL PDF / SENTINELPDF marks in a USPTO screen; Thales holds SENTINEL software-licensing marks — the user will have an attorney review before registering. The display name is one setting so a later rename is cheap.
- Shell: **Electron** (Chromium everywhere, matching the tested Chrome PWA), not Tauri.
- Signing: **Mac signed and notarized** with the user's existing Apple Developer account (Developer ID, direct distribution, not the Mac App Store). **Windows unsigned** for now (SmartScreen "Run anyway").
- Distribution: GitHub Releases on the public repo shemaiah7/pdfstudio, plus a `/download` page.

## Part A — Rename to SentinelPDF

User-visible text changes to "SentinelPDF":
- `index.html` title/meta, `public/manifest.webmanifest` (`name`, `short_name`, `description` unchanged in meaning), start-screen brand in `src/components/DropZone.tsx`, dialogs and prompts (`InstallButton.tsx`, `DefaultAppDialog.tsx`, `DefaultAppPrompt.tsx`, `src/pwa/defaultApp.ts`), terms (`public/terms.html`, `src/account/terms.ts`, `TermsDialog.tsx`), the assistant's self-description in `worker/src/prompts/*.ts`, `src/tokens.css` comments, README/docs.
- The default-app steps say "choose SentinelPDF".
- Tests and e2e that assert the old name are updated to the new one.
- Terms copy changes, so `TERMS_VERSION` is bumped in both the worker and the app (they must match).

Unchanged (internal; changing them would reset users or break infra):
- Repo name, Cloudflare Worker names `pdfstudio` / `pdfstudio-ai`, D1 `pdfstudio`, KV, `localStorage` keys `pdfstudio.*`, service-worker cache names, package names.
- Manifest `id` stays `/` so installed copies are the same app.

## Part B — Domain cutover (after the user buys sentinelpdf.com)

1. User (or a browser agent) adds sentinelpdf.com to the Cloudflare account 077a90710388bdf6a59d6fdff5e57adb (Free plan), sets Namecheap nameservers to Cloudflare's, and adds sentinelpdf.com and www.sentinelpdf.com to the Turnstile widget's hostnames.
2. In code: `wrangler.jsonc` (app) gets `routes` custom domains `sentinelpdf.com` and `www.sentinelpdf.com`; worker `ALLOWED_ORIGIN` becomes `https://sentinelpdf.com,https://www.sentinelpdf.com,https://pdfstudio.shemaiah7.workers.dev`; `APP_URL` becomes `https://sentinelpdf.com`.
3. workers.dev keeps serving (no redirect), so existing installs keep working.
4. Verified by: the site loads on both hostnames, `POST /session` from the new origin passes CORS, voice and AI work on the new domain.

## Part C — Desktop app (Electron)

### Shape
New `desktop/` folder with its own `package.json` (Electron + electron-builder + electron-updater), not part of the web build:
- `main.ts` — one window loading `APP_URL` (constant in `desktop/config.ts`: `https://sentinelpdf.com`; until Part B is live, `https://pdfstudio.shemaiah7.workers.dev`). Title "SentinelPDF", no address bar, remembers window size/position.
- `preload.ts` — `contextBridge` exposes only `window.sentinelDesktop = { version, onOpenFile(cb) }`. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `offline.html` — shown when the load fails: "You're offline. Reconnect to use SentinelPDF." with a Retry button.

### Opening PDFs
- electron-builder `fileAssociations`: `.pdf`, role Viewer/Editor (Mac `CFBundleDocumentTypes`, Windows registry via NSIS).
- Mac: `open-file` events (including those before the window is ready, queued). Windows: file paths in `process.argv` on first launch and in `second-instance` events. `requestSingleInstanceLock` so a second launch focuses the existing window.
- Main reads the file (only files ending `.pdf`, max 200 MB) and sends `{ name, bytes }` to the page over one IPC channel; the preload delivers it to `onOpenFile` subscribers. Files that arrive before the page subscribes are queued and flushed on subscribe.
- Web app: `src/desktop/bridge.ts` detects `window.sentinelDesktop`, subscribes once in `App.tsx`, wraps bytes in a `File` and calls the existing `handleFiles` (same path as drop and `launchQueue`).

### Security rules
- Navigation inside the window is allowed only to `APP_URL`'s origin (and the workers.dev origin during transition). Any other link or `window.open` (Stripe, Clerk-hosted pages if any, terms, help) opens in the default browser via `shell.openExternal` — http/https only.
- Permission requests: `media` (microphone) granted only to the app origin; everything else denied.
- Turnstile and Clerk run on the real origin, so no worker changes are needed for the desktop app.

### In the web app when running inside the desktop app
- `InstallButton`, `DefaultAppButton`, `DefaultAppPrompt` render nothing when `window.sentinelDesktop` exists.

### Build, signing, release
- GitHub Actions workflow `desktop.yml`, triggered by tags `desktop-v*` (and manual dispatch):
  - macOS runner: universal `.dmg` (arm64 + x64), hardened runtime, entitlements for JIT and microphone (`NSMicrophoneUsageDescription`), signed with Developer ID and notarized. Secrets: `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
  - Windows runner: NSIS `.exe` (x64), unsigned.
  - Both publish to a GitHub Release with stable asset names `SentinelPDF-mac.dmg` and `SentinelPDF-windows.exe` plus updater metadata (`latest-mac.yml`, `latest.yml`, Mac `.zip`).
- Mac app ID `com.sentinelpdf.desktop` (permanent). Product name SentinelPDF. Icons generated from `public/icons/icon-512.png` (`.icns`, `.ico`).
- `docs/desktop-setup.md`: click-by-click steps for the user to create the Developer ID Application certificate, export the .p12, create an app-specific password, find the Team ID, and add the five secrets. Claude never handles these values.

### Updates
- `electron-updater` checks GitHub Releases at launch and every 6 hours, downloads in the background, then shows a native "Restart to update" prompt. Failures are silent (logged).

### Download page
- `public/download.html` (served at `/download`, same visual language as `terms.html`, light/dark): "Download for Mac" / "Download for Windows" buttons pointing at `https://github.com/shemaiah7/pdfstudio/releases/latest/download/SentinelPDF-mac.dmg` and `...-windows.exe`, the detected OS's button first, a short note on the Windows "More info → Run anyway" warning, and system requirements (macOS 12+, Windows 10+ x64).
- Start screen: the install pill on Safari-on-Mac and the default-app dialog get a "Get the desktop app" link to `/download`.

## Error handling
- Page fails to load → `offline.html`, Retry reloads `APP_URL`.
- Non-PDF or oversized file → ignored in main with a native message box ("SentinelPDF can only open PDF files up to 200 MB.").
- Update check fails → no UI.

## Testing
- Desktop unit tests (vitest in `desktop/`): URL allow-list, external-link routing, permission handler, argv/open-file parsing and queueing, file-size/type guard.
- Web unit tests: `bridge.ts` (no bridge → no-op; bridge → `handleFiles` called with a `File`), install/default-app UI hidden in desktop.
- CI: build the desktop app on macOS and Windows in `desktop.yml` on PRs that touch `desktop/` (unsigned on PRs), plus a smoke test that launches the packaged app with Playwright's Electron support and checks the window title.
- Manual: the user installs the signed `.dmg`, double-clicks a PDF, uses Voice.

## Out of scope
- Mac App Store, iOS/Android apps, Windows code signing, Linux builds, offline editing in the desktop app, buying the domain or handling any credentials.

## Order of work
1. Rename (Part A) — ships on its own.
2. Desktop app + download page (Part C) using the workers.dev URL.
3. Domain cutover (Part B) once DNS is active; flip `desktop/config.ts` to sentinelpdf.com and cut a desktop release.
