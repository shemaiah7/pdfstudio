// Page side of the SentinelPDF browser extension. The extension's content script posts versioned
// messages to this window; the page never fetches, or navigates to, a URL it was handed.

/** Set to the store listing URL once it exists; the timeout banner then offers it. */
export const EXTENSION_INSTALL_URL: string | null = null;

/** Protocol version carried by every window message in both directions. */
export const PROTOCOL_VERSION = 1;

export const TIMEOUT_MESSAGE = "Couldn't reach the SentinelPDF browser extension. Install it, or open the PDF the usual way.";

export interface ExtensionErrorInfo { reason: string; url: string }
export interface ExtensionHandlers {
  onFetching(name: string): void;
  onFiles(files: File[]): void;
  onError(message: string, info: ExtensionErrorInfo): void;
}

// The hand-off fragment is `#sx=<token>&open=<url>`: open= is always last, so everything after
// the first `open=` field is the URL, `&` and all.
const OPEN_FIELD = /(?:^|&)open=/;
const body = (hash: string) => hash.replace(/^#/, "");

export function pendingOpenUrl(hash: string = location.hash): string | null {
  const h = body(hash);
  const m = OPEN_FIELD.exec(h);
  if (!m) return null;
  return h.slice(m.index + m[0].length) || null;
}

/** Only for tests: the page itself never needs the token. */
export function pendingOpenToken(hash: string = location.hash): string | null {
  const h = body(hash);
  const m = OPEN_FIELD.exec(h);
  const head = m ? h.slice(0, m.index) : h;
  const t = /(?:^|&)sx=([^&]*)/.exec(head);
  return t && t[1] ? t[1] : null;
}

export function clearOpenHash(): void {
  try { history.replaceState(history.state, "", location.pathname + location.search); } catch { /* ignore */ }
}

export function fileNameFrom(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (!last) return "document.pdf";
    try { return decodeURIComponent(last); } catch { return last; }
  } catch { return "document.pdf"; }
}

export function messageFor(reason: unknown): string {
  const r = typeof reason === "string" ? reason : "";
  if (r === "not-pdf") return "That link isn't a PDF.";
  if (r === "file-access") return "SentinelPDF can't read files on your computer until you turn on “Allow access to file URLs” for the extension.";
  if (r === "network") return "Couldn't fetch the PDF. Check the link or your connection.";
  if (r === "untrusted") return "This link wasn't opened by the SentinelPDF extension. Open the PDF in a tab and use the SentinelPDF toolbar button.";
  const http = /^http-(\d{3})$/.exec(r);
  if (http) return `Couldn't fetch the PDF (HTTP ${http[1]}). Open it the usual way and use the SentinelPDF button on that page.`;
  return "Couldn't open that PDF.";
}

/** These failures are about the link itself, so offer to open it without SentinelPDF. */
export const canOpenOriginal = (reason: string): boolean => reason === "not-pdf" || reason.startsWith("http-");

export function openOriginalMessage(url: string) {
  return { v: PROTOCOL_VERSION, type: "sentinelpdf:open-original", url };
}

export function openOriginal(url: string): void {
  window.postMessage(openOriginalMessage(url), location.origin);
}

const isBuffer = (b: unknown): b is ArrayBuffer => Object.prototype.toString.call(b) === "[object ArrayBuffer]";
const postReady = () => window.postMessage({ v: PROTOCOL_VERSION, type: "sentinelpdf:ready" }, location.origin);

export function subscribeExtensionBridge(h: ExtensionHandlers): () => void {
  const on = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data as { v?: unknown; type?: unknown; url?: unknown; name?: unknown; bytes?: unknown; reason?: unknown } | null;
    if (!d || typeof d !== "object" || d.v !== PROTOCOL_VERSION || typeof d.type !== "string") return;
    switch (d.type) {
      case "sentinelpdf:ping": postReady(); break;
      case "sentinelpdf:fetching":
        if (typeof d.url === "string") h.onFetching(fileNameFrom(d.url));
        break;
      case "sentinelpdf:open-file":
        if (typeof d.name === "string" && isBuffer(d.bytes)) h.onFiles([new File([d.bytes], d.name, { type: "application/pdf" })]);
        break;
      case "sentinelpdf:open-error": {
        const reason = typeof d.reason === "string" ? d.reason : "";
        h.onError(messageFor(reason), { reason, url: typeof d.url === "string" ? d.url : "" });
        break;
      }
    }
  };
  window.addEventListener("message", on);
  // The content script may have pinged before this listener existed.
  postReady();
  return () => window.removeEventListener("message", on);
}

/** When the page was opened with a hand-off link, give the extension `ms` to answer before giving up. */
export function watchPendingOpen(onTimeout: () => void, ms = 8000): { cancel(): void } {
  if (pendingOpenUrl() === null) return { cancel() {} };
  const t = setTimeout(onTimeout, ms);
  return { cancel() { clearTimeout(t); } };
}
