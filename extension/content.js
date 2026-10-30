// Runs only on the SentinelPDF origins (see manifest). Bridges the page and the background worker:
// the page asks nothing of the network; this script hands the URL from the hand-off link to the
// background, and passes the fetched bytes back as a window message. Content scripts cannot import
// ES modules, so the two small helpers below are copies of the ones in lib.js.
(() => {
  const V = 1;
  const ORIGIN = location.origin;
  const post = (m, transfer) => window.postMessage({ v: V, ...m }, ORIGIN, transfer);

  const OPEN_FIELD = /(?:^|&)open=/;
  function parseHash(hash) {
    const h = hash.replace(/^#/, "");
    const m = OPEN_FIELD.exec(h);
    if (!m) return null;
    const url = h.slice(m.index + m[0].length);
    const t = /(?:^|&)sx=([^&]*)/.exec(h.slice(0, m.index));
    return url ? { url, token: t ? t[1] : "" } : null;
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  let pageReady = false;
  let handedUrl = null;   // the URL this page load asked us to fetch
  let inFlight = false;
  let done = null;        // { name, bytes } waiting for the page to say it is ready

  function deliver() {
    if (!done || !pageReady) return;
    const { name, bytes } = done;
    done = null;
    post({ type: "sentinelpdf:open-file", name, bytes }, [bytes]);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== ORIGIN) return;
    const d = e.data;
    if (!d || typeof d !== "object" || d.v !== V) return;
    if (d.type === "sentinelpdf:ready") {
      pageReady = true;
      // The page may have mounted after our first "fetching" post; repeat it so the progress line and timeout cancel both land.
      if (inFlight && handedUrl) post({ type: "sentinelpdf:fetching", url: handedUrl });
      deliver();
    } else if (d.type === "sentinelpdf:open-original") {
      if (typeof d.url === "string" && d.url === handedUrl) chrome.runtime.sendMessage({ type: "open-original", url: d.url });
    }
  });

  post({ type: "sentinelpdf:ping" });

  const req = parseHash(location.hash);
  if (!req) return;
  handedUrl = req.url;
  inFlight = true;
  post({ type: "sentinelpdf:fetching", url: req.url });

  const fail = (reason) => {
    if (!inFlight) return;
    inFlight = false;
    post({ type: "sentinelpdf:open-error", reason, url: req.url });
  };

  let name = "document.pdf";
  const parts = [];
  const port = chrome.runtime.connect({ name: "fetch" });
  port.onMessage.addListener((m) => {
    if (!m || typeof m !== "object") return;
    if (m.type === "meta") {
      name = String(m.name || name);
    } else if (m.type === "chunk") {
      parts.push(base64ToBytes(m.data));
    } else if (m.type === "done") {
      inFlight = false;
      const total = parts.reduce((n, p) => n + p.length, 0);
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.length; }
      parts.length = 0;
      done = { name, bytes: bytes.buffer };
      deliver();
    } else if (m.type === "error") {
      fail(String(m.reason || "network"));
    }
  });
  // The background closes the port after "done"/"error"; closing mid-transfer means the worker died.
  port.onDisconnect.addListener(() => fail("network"));
  port.postMessage({ url: req.url, token: req.token });
})();
