// Pure helpers shared by the background worker and the popup (ES module). content.js cannot import
// modules, so it carries its own copy of the two tiny helpers it needs (hash parsing, base64 decode).

export const DEFAULT_ORIGIN = "https://sentinelpdf.com";
export const RULE_ID = 1;
/** Raw bytes per base64 chunk sent over the port (must stay under 2 MiB). */
export const chunkSize = 1024 * 1024;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True when "%PDF-" appears within the first 1024 bytes (PDF readers accept leading junk up to that). */
export function isPdfBytes(bytes) {
  const end = Math.min(bytes.length, 1024) - PDF_MAGIC.length;
  for (let i = 0; i <= end; i++) {
    let j = 0;
    while (j < PDF_MAGIC.length && bytes[i + j] === PDF_MAGIC[j]) j++;
    if (j === PDF_MAGIC.length) return true;
  }
  return false;
}

export const isPdfResponse = (contentType, bytes) => /pdf/i.test(contentType || "") || isPdfBytes(bytes);

const withPdfSuffix = (n) => (/\.pdf$/i.test(n) ? n : n + ".pdf");
const lastSegment = (p) => p.split(/[\\/]/).filter(Boolean).pop() || "";
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function dispositionName(cd) {
  if (!cd) return "";
  const star = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(cd);
  if (star) return safeDecode(star[1].trim().replace(/^"|"$/g, ""));
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(cd);
  return plain ? (plain[1] ?? plain[2]).trim() : "";
}

/** Content-Disposition filename, else the decoded last path segment, else document.pdf; always ends in .pdf. */
export function fileNameFrom(url, contentDisposition) {
  const fromHeader = lastSegment(dispositionName(contentDisposition));
  if (fromHeader) return withPdfSuffix(fromHeader);
  try {
    const seg = lastSegment(safeDecode(new URL(url).pathname));
    if (seg) return withPdfSuffix(seg);
  } catch { /* not a URL */ }
  return "document.pdf";
}

export const stripFragment = (url) => { const i = url.indexOf("#"); return i < 0 ? url : url.slice(0, i); };

const trimSlash = (o) => o.replace(/\/+$/, "");

/** `<origin>/#sx=<token>&open=<url>`: the URL rides in the fragment so it is never sent to a server. */
export const handoffUrl = (origin, token, url) => `${trimSlash(origin)}/#sx=${token}&open=${stripFragment(url)}`;

export function buildRule(origin, token) {
  return {
    id: RULE_ID,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: `${trimSlash(origin)}/#sx=${token}&open=\\0` } },
    condition: {
      regexFilter: "^https?://.*\\.pdf(\\?.*)?$",
      isUrlFilterCaseSensitive: false,
      resourceTypes: ["main_frame"],
      excludedRequestDomains: [new URL(origin).hostname],
    },
  };
}

export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 16 random bytes, base64url. */
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isFetchableUrl(url) {
  try { return ["http:", "https:", "file:"].includes(new URL(url).protocol); } catch { return false; }
}

/** Whether the popup / menus can send this page to SentinelPDF (not browser pages, not the app itself). */
export function canHandOff(url, origin) {
  if (!url || !isFetchableUrl(url)) return false;
  try { return new URL(url).origin !== new URL(origin).origin; } catch { return false; }
}
