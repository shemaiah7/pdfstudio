# Store listing copy (Chrome Web Store and Edge Add-ons)

Text only; submission is a manual step (see README.md).

## Name

SentinelPDF — open PDFs in SentinelPDF

## Summary (max 132 characters)

Open PDF links in SentinelPDF instead of the browser viewer. Edit, sign and ask questions. Nothing is uploaded.

(Count: 111.)

## Description

SentinelPDF is a PDF editor and reader that runs in your browser. This extension sends the PDFs you open on the web to
SentinelPDF, so you can mark them up, fill and sign forms, reorder pages, search them and ask questions about them,
without installing any software.

What it does
- Click a link to a PDF and it opens in SentinelPDF instead of the browser's built-in viewer. You can turn this off in the toolbar popup.
- Use the toolbar button, or right-click a page or a link, to send any PDF to SentinelPDF on demand.
- Works with PDFs behind a sign-in, such as an intranet portal, because the extension reads the file with your browser's own login.
- PDFs on your computer work too once you turn on "Allow access to file URLs" in the extension's details.

Your privacy
- The PDF is fetched by the extension and handed to the SentinelPDF page in your browser. It is not uploaded.
- The link you opened travels in the page address after a "#", which browsers never send to a server.
- No analytics, no tracking, no third-party requests. The only thing stored is your on/off setting.

Requires a Chromium-based browser (Chrome or Edge).

## Single purpose

Open PDF files that the user browses to in the SentinelPDF web app instead of the browser's built-in PDF viewer.

## Permission justifications

- `<all_urls>` (host permission): to fetch the PDF the user chose to open, with the user's browser login, from any website. A web page cannot fetch it because of cross-origin rules, so the extension's background worker does. It is used only for the PDF the user opened, and the bytes go only to the SentinelPDF page.
- `declarativeNetRequest`: to redirect navigations to `.pdf` addresses to SentinelPDF while the "open automatically" setting is on.
- `storage`: to remember the single "open PDF links automatically" setting, and a per-session token that keeps web pages from triggering fetches.
- `contextMenus`: the "Open link in SentinelPDF" and "Open this page in SentinelPDF" right-click items.
- `tabs`: to read the current tab's address for the toolbar button and to open SentinelPDF in the same or a new tab.

Remote code: none. All code ships in the package.

## Data disclosure (store questionnaire)

Collects no user data. Does not sell or transfer data. Does not use data for purposes unrelated to the single purpose. The PDF a user opens is processed locally in the browser.

## Privacy policy URL

https://sentinelpdf.com/privacy.html

## Submission steps

1. Chrome Web Store: sign in to the developer dashboard (one-time $5 registration fee), choose Add new item, upload `extension/dist/sentinelpdf-extension-<version>.zip` (from `npm run extension:pack`), paste the copy above, add screenshots, enter the permission justifications and privacy policy URL, submit for review.
2. Edge Add-ons: Partner Center, new extension, upload the same zip, reuse the same copy, submit.
3. The extension ID is known only after the first upload. The web app does not need it.
4. Deploy the web-app side (README, "Release") before submitting.
