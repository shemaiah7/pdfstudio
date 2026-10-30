// SentinelPDF extension service worker. The only place that fetches a PDF: the page can't (CORS),
// and it never navigates to a URL it was handed. Nothing here talks to any server except the PDF's own host.
import {
  DEFAULT_ORIGIN, RULE_ID, buildRule, handoffUrl, newToken, isFetchableUrl, canHandOff, isPdfResponse,
  fileNameFrom, bytesToBase64, chunkSize, stripFragment,
} from "./lib.js";

const MENU_LINK = "open-link";
const MENU_PAGE = "open-page";

async function appOrigin() {
  const { appOrigin: o } = await chrome.storage.local.get("appOrigin");
  return typeof o === "string" && o ? o.replace(/\/+$/, "") : DEFAULT_ORIGIN;
}

async function autoOpenOn() {
  const { autoOpen } = await chrome.storage.sync.get({ autoOpen: true });
  return autoOpen !== false;
}

/** Per-browser-session secret; only hand-off links minted here are allowed to trigger a fetch. */
async function sessionToken() {
  const { token } = await chrome.storage.session.get("token");
  if (token) return token;
  const fresh = newToken();
  await chrome.storage.session.set({ token: fresh });
  return fresh;
}

async function applyRules() {
  if (!(await autoOpenOn())) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID] });
    return;
  }
  const rule = buildRule(await appOrigin(), await sessionToken());
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules: [rule] });
}

// Serialized so concurrent triggers (install + storage change) can't mint two tokens or interleave updates.
let rulesChain = Promise.resolve();
function ensureRules() {
  rulesChain = rulesChain.then(applyRules, applyRules).catch((err) => console.error("ensureRules", err));
  return rulesChain;
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_LINK, title: "Open link in SentinelPDF", contexts: ["link"] });
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Open this page in SentinelPDF", contexts: ["page"] });
  });
}

chrome.runtime.onInstalled.addListener(() => { createMenus(); void ensureRules(); });
chrome.runtime.onStartup.addListener(async () => {
  // storage.session does not survive a browser restart, but clear it explicitly so a stale token can never linger.
  await chrome.storage.session.remove("token");
  await ensureRules();
});
chrome.storage.onChanged.addListener((changes) => {
  if ("autoOpen" in changes || "appOrigin" in changes) void ensureRules();
});

async function handOff(url, how, tabId) {
  const origin = await appOrigin();
  if (!canHandOff(url, origin)) return;
  const target = handoffUrl(origin, await sessionToken(), url);
  if (how === "new-tab") {
    const tab = tabId == null ? null : await chrome.tabs.get(tabId).catch(() => null);
    await chrome.tabs.create(tab ? { url: target, index: tab.index + 1 } : { url: target });
  } else if (tabId != null) {
    await chrome.tabs.update(tabId, { url: target });
  } else {
    await chrome.tabs.create({ url: target });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_LINK && info.linkUrl) void handOff(info.linkUrl, "new-tab", tab?.id);
  else if (info.menuItemId === MENU_PAGE) void handOff(info.pageUrl || tab?.url, "same-tab", tab?.id);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== "object") return;
  if (msg.type === "open-url" && typeof msg.url === "string") {
    // From the popup (no sender.tab); how/tabId come from the popup.
    void handOff(msg.url, msg.how === "new-tab" ? "new-tab" : "same-tab", msg.tabId);
  } else if (msg.type === "open-original" && typeof msg.url === "string" && sender.tab?.id != null && isFetchableUrl(msg.url)) {
    void openOriginal(sender.tab.id, msg.url);
  }
});

/** Let one navigation through to the browser's own viewer: drop the redirect rule, go, restore it shortly after. */
async function openOriginal(tabId, url) {
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID] });
  await chrome.tabs.update(tabId, { url: stripFragment(url) });
  setTimeout(() => { void ensureRules(); }, 5000);
}

// ---- fetching -------------------------------------------------------------------------------

const fileAccessAllowed = () => new Promise((resolve) => chrome.extension.isAllowedFileSchemeAccess(resolve));

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "fetch" || port.sender?.id !== chrome.runtime.id) return;
  const ac = new AbortController();
  let started = false;
  port.onDisconnect.addListener(() => ac.abort());
  port.onMessage.addListener((msg) => {
    if (started) return;
    started = true;
    void serveFetch(port, msg, ac.signal);
  });
});

async function serveFetch(port, msg, signal) {
  const send = (m) => { try { port.postMessage(m); } catch { /* port closed */ } };
  const fail = (reason) => send({ type: "error", reason });
  try {
    const url = msg && typeof msg.url === "string" ? msg.url : "";
    const { token } = await chrome.storage.session.get("token");
    if (!token || !msg || msg.token !== token || !isFetchableUrl(url)) return fail("untrusted");

    const isFile = new URL(url).protocol === "file:";
    if (isFile && !(await fileAccessAllowed())) return fail("file-access");

    let res;
    try {
      res = await fetch(stripFragment(url), { credentials: "include", redirect: "follow", signal });
    } catch {
      if (signal.aborted) return;
      return fail(isFile ? "file-access" : "network");
    }
    if (!res.ok) return fail(`http-${res.status}`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (signal.aborted) return;
    if (!isPdfResponse(res.headers.get("Content-Type"), bytes)) return fail("not-pdf");

    send({ type: "meta", name: fileNameFrom(res.url || url, res.headers.get("Content-Disposition")), size: bytes.length });
    for (let i = 0; i < bytes.length; i += chunkSize) {
      if (signal.aborted) return;
      send({ type: "chunk", data: bytesToBase64(bytes.subarray(i, i + chunkSize)) });
    }
    send({ type: "done" });
  } catch {
    if (!signal.aborted) fail("network");
  } finally {
    try { port.disconnect(); } catch { /* already closed */ }
  }
}
