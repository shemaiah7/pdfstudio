# SentinelPDF browser extension

Chrome and Edge extension (Manifest V3) that sends PDFs you open in the browser to
[sentinelpdf.com](https://sentinelpdf.com) instead of the built-in viewer. No installer, no download.

## What it does

- **Automatic:** a link or address that goes to a `.pdf` opens in SentinelPDF. Turn this off in the toolbar popup.
- **On demand:** the toolbar button ("Open this page in SentinelPDF"), and the right-click menu on a link
  ("Open link in SentinelPDF") or on a page ("Open this page in SentinelPDF").
- **Signed-in PDFs:** the extension's background worker fetches the PDF with the browser's own cookies, so
  intranet PDFs behind a login work as far as the browser allows.
- **Privacy:** the PDF's URL travels in the URL fragment (`#sx=<token>&open=<url>`), which browsers never send to
  a server. Only the background worker fetches. The page never fetches or navigates to a URL it was handed.
  No analytics, no third-party requests.

## How it works

```
.pdf link -> declarativeNetRequest redirect -> https://sentinelpdf.com/#sx=<token>&open=<pdf url>
content.js (on sentinelpdf.com) reads the hash -> port "fetch" -> background.js fetches the bytes
background.js -> base64 chunks over the port -> content.js -> window.postMessage (v: 1) -> the page opens the file
```

- `sx` is a per-browser-session token minted by the background worker. A hand-off link without the right token is refused
  (`untrusted`), so a web page cannot make the extension fetch arbitrary URLs.
- Window messages between `content.js` and the page carry `v: 1` (see `src/extension/bridge.ts`).
  Changing the protocol bumps `v` and keeps accepting the previous value for one extension release.
- `lib.js` holds the pure helpers (unit-tested in `lib.test.js`). `content.js` is a classic script and cannot import
  modules, so it carries small copies of the hash parser and base64 decoder.

## Load it unpacked (development)

The shipped manifest only matches the sentinelpdf.com origins. For local work, build the development copy, which also
matches `http://localhost/*` and `http://127.0.0.1/*`:

```sh
npm run extension:dev        # writes extension/dist/dev
```

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. **Load unpacked** and pick `extension/dist/dev`.
3. To point it at a local app (dev and tests only; there is no UI for this), run this in the extension's
   service-worker console: `chrome.storage.local.set({ appOrigin: "http://localhost:5173" })`.
   The redirect rule rebuilds on the change. Remove the key to go back to `https://sentinelpdf.com`.
4. Visit any public `.pdf` URL: it should open in the app. The popup toggle turns that off.

### PDFs on your computer (`file://`)

Chrome and Edge keep extensions out of local files by default. Open the extension's **Details** page and turn on
**Allow access to file URLs**. Then use the toolbar button on a `file://...pdf` tab. Without it, SentinelPDF shows
a message saying so. (The automatic rule only covers `http` and `https`.)

## Tests

- `npm test` runs `extension/lib.test.js` with the rest of the unit tests.
- `npx playwright test e2e/extension.spec.ts` loads `extension/dist/dev` in Chromium (the spec builds it itself) and
  exercises the redirect, the not-a-PDF path, the toggle and the no-extension message.

## Release and store submission

1. **Merge and deploy the web-app side first.** The store review lags deploys, and the extension only works against a
   site that understands the `v: 1` hand-off (`src/extension/bridge.ts`). Merge the change to `main` and run
   `npm run deploy` before submitting.
2. Bump `version` in `manifest.json` (the stores reject a version they already have).
3. `npm run extension:pack` -> `extension/dist/sentinelpdf-extension-<version>.zip` (tests, README and STORE.md are left out).
4. Submit the same zip to both stores, using the copy and permission justifications in [STORE.md](STORE.md):
   - Chrome Web Store: developer dashboard (one-time $5 registration), upload the zip, fill the listing.
   - Edge Add-ons: Partner Center, upload the same zip.
5. After the first upload the extension ID is known. Once the listing is live, set `EXTENSION_INSTALL_URL` in
   `src/extension/bridge.ts` so the "couldn't reach the extension" banner links to it.

Known side effect: while automatic opening is on, `.pdf` links meant as downloads also open in SentinelPDF.
Not covered: PDFs served without a `.pdf` URL are not detected automatically (use the toolbar button), and Firefox/Safari.
