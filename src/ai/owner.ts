// Owner key capture: opening https://<site>/#owner=<key> once unlocks unlimited use in this browser.
export const OWNER_STORAGE_KEY = "pdfstudio.ownerKey";

export function getOwnerKey(): string | null {
  try { return localStorage.getItem(OWNER_STORAGE_KEY) || null; } catch { return null; }
}

/** Reads `owner=` from the URL hash, stores (or clears) it, and removes the hash so the key never lingers in the address bar. */
export function captureOwnerKey(): void {
  if (typeof location === "undefined") return;
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return;
  // Browser-extension hand-off (#sx=<token>&open=<url>): the URL may contain "owner=", so leave it for the extension bridge.
  if (hash.startsWith("sx=") || hash.startsWith("open=")) return;
  const parts = hash.split("&");
  const idx = parts.findIndex((p) => p === "owner" || p.startsWith("owner="));
  if (idx < 0) return;
  let key = parts[idx].slice("owner=".length);
  try { key = decodeURIComponent(key); } catch { /* keep the raw value */ }
  try {
    if (key) localStorage.setItem(OWNER_STORAGE_KEY, key);
    else localStorage.removeItem(OWNER_STORAGE_KEY);
  } catch { /* storage unavailable */ }
  parts.splice(idx, 1);
  const rest = parts.filter(Boolean).join("&");
  try { history.replaceState(history.state, "", location.pathname + location.search + (rest ? `#${rest}` : "")); } catch { /* ignore */ }
}

captureOwnerKey();
